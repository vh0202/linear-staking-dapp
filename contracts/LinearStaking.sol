// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/**
 * @title LinearStaking
 * @notice Stake one ERC-20 token and earn a reward token that is released linearly over
 *         time and shared pro rata to stake. Rewards do not compound.
 *
 * @dev SAMPLE CODE - NOT AUDITED. Written as a portfolio demonstration.
 *
 * Reward maths (the reward-per-token accumulator known from Synthetix `StakingRewards`):
 *
 *   rewardRate      r = R / D          R = rewards scheduled for the period, D = its duration
 *   rewardPerToken  A(t) = A(t0) + r * (t - t0) / S      while the total stake S > 0 is constant
 *   earned(u, t)        = settled(u) + stake(u) * (A(t) - A(checkpoint of u))
 *
 * `A` is brought up to date before every change of `S`, and an account's rewards are settled
 * before every change of its stake, so the two formulas hold piecewise between interactions.
 *
 * Fixed-point scales
 *   - `rewardRate` and `unallocatedRewards` carry 18 extra decimals ({RATE_PRECISION}), so a
 *     low-decimal reward token spread over a long period is not truncated to a coarse rate.
 *   - the accumulator carries 36 extra decimals ({ACC_PRECISION}), so a small reward rate
 *     divided by a very large total stake does not truncate to zero.
 *
 * Accounting and solvency
 *   - Principal and rewards are tracked in separate internal ledgers: `totalStaked`, and
 *     `rewardReserve() = totalRewardsFunded - totalRewardsPaid`. The contract never derives
 *     rewards from `balanceOf(address(this))`.
 *   - Rewards are pulled from the owner inside {fundRewards}; a reward rate is only ever set
 *     from tokens transferred in that same call plus rewards funded earlier and not yet
 *     emitted. A payout larger than the reserve reverts ({RewardExceedsReserve}).
 *   - After every inbound transfer the contract checks that it holds at least what it owes in
 *     that token ({InsufficientTokenBalance}). When the staking token and the reward token are
 *     the same token, the amount owed is principal + reward reserve, so rewards can never be
 *     paid out of stakers' principal.
 *   - All rounding is down, in favour of the pool: the sum of all payouts never exceeds the
 *     amount funded.
 *
 * Overflow bound
 *   Lifetime funding is capped at {MAX_TOTAL_REWARDS} = 2**128 - 1. Every intermediate value
 *   of the reward maths is bounded by `totalRewardsFunded * ACC_PRECISION` < 2**128 * 1e36
 *   < 2**256, so the reward maths cannot overflow and can never block {unstake}.
 *
 * Trust assumptions
 *   - The owner can pause/unpause, and can re-pace rewards that are already funded by calling
 *     {fundRewards} again (see that function). The owner cannot withdraw staked tokens or
 *     funded rewards: the contract has no function that sends tokens to the owner.
 *   - Pausing blocks {stake}, {claim} and {exit}. {unstake} is never pausable, so principal
 *     can always be withdrawn.
 *
 * Known limits
 *   - Fee-on-transfer tokens are not supported: {stake} and {fundRewards} revert when the
 *     transfer leaves the contract holding less than it owes.
 *   - Rebasing tokens (balances that change without a transfer) are not supported and cannot
 *     be detected; do not use them.
 *   - Tokens sent directly to the contract (not through {stake} or {fundRewards}) are not
 *     accounted for and cannot be recovered.
 *   - Rounding dust: each settlement rounds an account's rewards down by less than one wei
 *     of reward token, and each accumulator update truncates by less than
 *     `totalStaked / 1e36` wei (nothing for any realistic stake). The dust stays in the
 *     contract and is not recoverable.
 *   - Rewards emitted while nothing is staked are not lost, but they are only released again
 *     by the next {fundRewards} call, which adds them to the new period.
 *   - A staker who joins shortly before {fundRewards} shares the new period like anyone else;
 *     there is no lock-up or minimum staking time.
 */
contract LinearStaking is Ownable2Step, Pausable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Fixed-point scale of {rewardRate} and {unallocatedRewards}.
    uint256 public constant RATE_PRECISION = 1e18;

    /// @notice Fixed-point scale of the reward-per-token accumulator.
    uint256 public constant ACC_PRECISION = 1e36;

    /// @notice Shortest reward period that can be scheduled.
    /// @dev Very short periods are almost always an input mistake (e.g. a duration given in
    ///      days instead of seconds) and would hand the whole pool to whoever is staked for
    ///      a few blocks.
    uint256 public constant MIN_REWARD_DURATION = 1 hours;

    /// @notice Longest reward period that can be scheduled.
    uint256 public constant MAX_REWARD_DURATION = 5 * 365 days;

    /// @notice Lifetime cap on funded rewards, in reward-token wei. See "Overflow bound" above.
    uint256 public constant MAX_TOTAL_REWARDS = type(uint128).max;

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Token that users deposit.
    IERC20 public immutable stakingToken;

    /// @notice Token that rewards are paid in. May be the same token as {stakingToken}.
    IERC20 public immutable rewardsToken;

    /// @notice Reward tokens emitted per second, in reward-token wei scaled by {RATE_PRECISION}.
    uint256 public rewardRate;

    /// @notice Timestamp at which the current reward period ends (0 before the first funding).
    uint256 public periodFinish;

    /// @notice Timestamp up to which the accumulator has been brought up to date.
    uint256 public lastUpdateTime;

    /// @notice Accumulated rewards per staked token, scaled by {ACC_PRECISION}.
    uint256 public rewardPerTokenStored;

    /// @notice Funded rewards that are currently not scheduled, scaled by {RATE_PRECISION}:
    ///         emissions of seconds in which nothing was staked, plus the division remainder
    ///         of the last rate calculation. Added to the next reward period.
    uint256 public unallocatedRewards;

    /// @notice Sum of all staked balances.
    uint256 public totalStaked;

    /// @notice Reward tokens ever transferred in through {fundRewards}.
    uint256 public totalRewardsFunded;

    /// @notice Reward tokens ever paid out through {claim} and {exit}.
    uint256 public totalRewardsPaid;

    /// @notice Staked balance of an account.
    mapping(address account => uint256 amount) public stakedBalance;

    /// @notice Value of the accumulator when an account's rewards were last settled.
    mapping(address account => uint256 accumulator) public userRewardPerTokenPaid;

    /// @notice Rewards settled for an account at its last checkpoint and not yet paid.
    ///         Use {earned} for the up-to-date amount.
    mapping(address account => uint256 amount) public rewards;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice `account` deposited `amount` staking tokens.
    event Staked(address indexed account, uint256 amount);

    /// @notice `account` withdrew `amount` staking tokens.
    event Unstaked(address indexed account, uint256 amount);

    /// @notice `account` was paid `amount` reward tokens.
    event RewardPaid(address indexed account, uint256 amount);

    /// @notice `funder` added `amount` reward tokens and started a period of `duration` seconds.
    /// @param rewardRate   New emission rate, scaled by {RATE_PRECISION}. Includes rewards rolled
    ///                     over from the previous period and previously unallocated rewards.
    /// @param periodFinish Timestamp at which the new period ends.
    event RewardsFunded(
        address indexed funder,
        uint256 amount,
        uint256 duration,
        uint256 rewardRate,
        uint256 periodFinish
    );

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @notice A token address passed to the constructor was the zero address.
    error ZeroAddress();

    /// @notice The amount must be greater than zero.
    error ZeroAmount();

    /// @notice Tried to unstake more than the caller has staked.
    error InsufficientStake(uint256 requested, uint256 available);

    /// @notice The reward period is outside [{MIN_REWARD_DURATION}, {MAX_REWARD_DURATION}].
    error InvalidDuration(uint256 duration);

    /// @notice Funding `amount` would push lifetime rewards above {MAX_TOTAL_REWARDS};
    ///         only `available` more can ever be funded.
    error RewardCapExceeded(uint256 amount, uint256 available);

    /// @notice The contract holds less of `token` than it owes after an inbound transfer
    ///         (fee-on-transfer or otherwise non-standard token).
    error InsufficientTokenBalance(address token, uint256 held, uint256 owed);

    /// @notice A payout would exceed the reward reserve. Unreachable unless the reward ledger
    ///         is corrupted; kept as a hard stop so rewards can never be taken from principal.
    error RewardExceedsReserve(uint256 reward, uint256 reserve);

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/

    /// @dev Brings the accumulator up to date, then settles `account` (skipped for address(0)).
    modifier updateReward(address account) {
        _updateReward(account);
        _;
    }

    /*//////////////////////////////////////////////////////////////
                               CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @param stakingToken_ Token users stake. Must be a standard ERC-20 (see "Known limits").
    /// @param rewardsToken_ Token rewards are paid in. May equal `stakingToken_`.
    /// @param initialOwner  Account allowed to fund rewards and to pause.
    constructor(IERC20 stakingToken_, IERC20 rewardsToken_, address initialOwner) Ownable(initialOwner) {
        if (address(stakingToken_) == address(0) || address(rewardsToken_) == address(0)) {
            revert ZeroAddress();
        }
        stakingToken = stakingToken_;
        rewardsToken = rewardsToken_;
    }

    /*//////////////////////////////////////////////////////////////
                              USER ACTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Deposit `amount` staking tokens. Requires prior ERC-20 approval.
    /// @dev Reverts with {ZeroAmount} for `amount == 0` and while paused.
    function stake(uint256 amount) external nonReentrant whenNotPaused updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();

        totalStaked += amount;
        stakedBalance[msg.sender] += amount;
        emit Staked(msg.sender, amount);

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        _requireSolvent(stakingToken);
    }

    /// @notice Withdraw `amount` of the caller's staked tokens. Accrued rewards stay claimable.
    /// @dev Never pausable. Reverts with {ZeroAmount} or {InsufficientStake}.
    function unstake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        _decreaseStake(msg.sender, amount);
        stakingToken.safeTransfer(msg.sender, amount);
    }

    /// @notice Pay out all rewards accrued by the caller.
    /// @dev Calling with nothing accrued is a no-op: it returns 0, transfers nothing, emits
    ///      nothing and does not revert. Reverts while paused.
    /// @return reward Amount of reward tokens paid.
    function claim() external nonReentrant whenNotPaused updateReward(msg.sender) returns (uint256 reward) {
        reward = _takeRewards(msg.sender);
        if (reward != 0) rewardsToken.safeTransfer(msg.sender, reward);
    }

    /// @notice Withdraw the caller's entire stake and pay out all accrued rewards.
    /// @dev Equivalent to `unstake(stakedBalance(caller))` followed by `claim()`. Reverts with
    ///      {ZeroAmount} when the caller has nothing staked, and while paused (use {unstake}).
    /// @return amount Staking tokens returned.
    /// @return reward Reward tokens paid.
    function exit()
        external
        nonReentrant
        whenNotPaused
        updateReward(msg.sender)
        returns (uint256 amount, uint256 reward)
    {
        amount = stakedBalance[msg.sender];
        _decreaseStake(msg.sender, amount);
        reward = _takeRewards(msg.sender);

        stakingToken.safeTransfer(msg.sender, amount);
        if (reward != 0) rewardsToken.safeTransfer(msg.sender, reward);
    }

    /*//////////////////////////////////////////////////////////////
                              OWNER ACTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Pull `amount` reward tokens from the owner and start a reward period that
    ///         lasts `duration` seconds from now. Requires prior ERC-20 approval.
    /// @dev The new period distributes `amount` plus everything funded earlier that has not
    ///      been emitted yet: the remainder of a still-running period and {unallocatedRewards}.
    ///
    ///        rewardRate = (amount + remaining * oldRate + unallocated) / duration
    ///
    ///      Calling this during a running period therefore replaces its schedule: rewards
    ///      already accrued are unaffected, the rest is re-paced over `duration`. The owner
    ///      can slow down or speed up emission this way, but cannot remove rewards.
    ///
    ///      Reverts with {ZeroAmount}, {InvalidDuration}, {RewardCapExceeded}, or
    ///      {InsufficientTokenBalance} if fewer than `amount` tokens actually arrived. The
    ///      resulting rate is never zero because `amount >= 1` wei is scaled by 1e18, far
    ///      above {MAX_REWARD_DURATION}.
    /// @param amount   Reward tokens to add, in reward-token wei.
    /// @param duration Length of the new period in seconds.
    function fundRewards(
        uint256 amount,
        uint256 duration
    ) external onlyOwner nonReentrant updateReward(address(0)) {
        if (amount == 0) revert ZeroAmount();
        if (duration < MIN_REWARD_DURATION || duration > MAX_REWARD_DURATION) {
            revert InvalidDuration(duration);
        }
        uint256 funded = totalRewardsFunded;
        uint256 available = MAX_TOTAL_REWARDS - funded;
        if (amount > available) revert RewardCapExceeded(amount, available);
        funded += amount;

        // Everything below is scaled by RATE_PRECISION. `updateReward` has just accounted for
        // all emissions up to this block, so what is left of a running period is exact.
        uint256 pool = amount * RATE_PRECISION + unallocatedRewards;
        if (block.timestamp < periodFinish) {
            pool += (periodFinish - block.timestamp) * rewardRate;
        }
        uint256 newRate = pool / duration;
        uint256 newPeriodFinish = block.timestamp + duration;

        rewardRate = newRate;
        unallocatedRewards = pool - newRate * duration; // division remainder, below one wei
        lastUpdateTime = block.timestamp;
        periodFinish = newPeriodFinish;
        totalRewardsFunded = funded;
        emit RewardsFunded(msg.sender, amount, duration, newRate, newPeriodFinish);

        rewardsToken.safeTransferFrom(msg.sender, address(this), amount);
        _requireSolvent(rewardsToken);
    }

    /// @notice Emergency stop: blocks {stake}, {claim} and {exit}. {unstake} keeps working.
    /// @dev Rewards keep accruing to existing stakers while paused.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Lift the emergency stop.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Give up ownership for good. No further reward periods can be funded and the
    ///         contract can no longer be paused.
    /// @dev Blocked while paused: an ownerless paused pool could never be unpaused, which
    ///      would lock all unclaimed rewards.
    function renounceOwnership() public override whenNotPaused {
        super.renounceOwnership();
    }

    /*//////////////////////////////////////////////////////////////
                                  VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice The current time, capped at the end of the reward period.
    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    /// @notice Up-to-date value of the reward-per-token accumulator, scaled by {ACC_PRECISION}.
    function rewardPerToken() public view returns (uint256) {
        uint256 staked = totalStaked;
        if (staked == 0) return rewardPerTokenStored;

        // Emission since the last checkpoint, scaled by RATE_PRECISION, lifted to ACC_PRECISION.
        uint256 emitted = (lastTimeRewardApplicable() - lastUpdateTime) * rewardRate;
        return rewardPerTokenStored + (emitted * (ACC_PRECISION / RATE_PRECISION)) / staked;
    }

    /// @notice Rewards `account` could claim right now, in reward-token wei.
    function earned(address account) public view returns (uint256) {
        return _earned(account, rewardPerToken());
    }

    /// @notice Funded rewards that have not been paid out yet, in reward-token wei. Covers
    ///         accrued-but-unclaimed rewards, future emissions, {unallocatedRewards} and dust.
    function rewardReserve() public view returns (uint256) {
        return totalRewardsFunded - totalRewardsPaid;
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNALS
    //////////////////////////////////////////////////////////////*/

    function _updateReward(address account) private {
        uint256 accumulator = rewardPerTokenStored;
        uint256 applicable = lastTimeRewardApplicable();
        uint256 last = lastUpdateTime;

        if (applicable != last) {
            if (totalStaked == 0) {
                // Nobody earned these seconds: keep the emission for the next period.
                unallocatedRewards += (applicable - last) * rewardRate;
            } else {
                accumulator = rewardPerToken();
                rewardPerTokenStored = accumulator;
            }
            lastUpdateTime = applicable;
        }

        if (account != address(0)) {
            rewards[account] = _earned(account, accumulator);
            userRewardPerTokenPaid[account] = accumulator;
        }
    }

    function _earned(address account, uint256 accumulator) private view returns (uint256) {
        return
            rewards[account] +
            (stakedBalance[account] * (accumulator - userRewardPerTokenPaid[account])) /
            ACC_PRECISION;
    }

    /// @dev Checks and effects of an unstake. The caller performs the token transfer.
    function _decreaseStake(address account, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        uint256 staked = stakedBalance[account];
        if (amount > staked) revert InsufficientStake(amount, staked);

        stakedBalance[account] = staked - amount;
        totalStaked -= amount;
        emit Unstaked(account, amount);
    }

    /// @dev Effects of a reward payout. The caller performs the token transfer.
    function _takeRewards(address account) private returns (uint256 reward) {
        reward = rewards[account];
        if (reward == 0) return 0;

        uint256 reserve = totalRewardsFunded - totalRewardsPaid;
        if (reward > reserve) revert RewardExceedsReserve(reward, reserve);

        rewards[account] = 0;
        totalRewardsPaid += reward;
        emit RewardPaid(account, reward);
    }

    /// @dev Reverts unless the contract holds at least what it owes in `token`: principal if
    ///      it is the staking token, plus the reward reserve if it is the reward token.
    function _requireSolvent(IERC20 token) private view {
        uint256 owed;
        if (address(token) == address(stakingToken)) owed = totalStaked;
        if (address(token) == address(rewardsToken)) owed += totalRewardsFunded - totalRewardsPaid;

        uint256 held = token.balanceOf(address(this));
        if (held < owed) revert InsufficientTokenBalance(address(token), held, owed);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";

import {LinearStaking} from "../../contracts/LinearStaking.sol";
import {MockERC20} from "../../contracts/mocks/MockERC20.sol";

/// @notice Drives a pool with random calls from five actors. It owns the pool, so it can also
///         fund reward periods and toggle the pause. Every call is built to be valid; with
///         `failOnRevert` enabled any unexpected revert (for example an unstake that fails)
///         breaks the run.
contract StakingHandler is Test {
    uint256 private constant ACTORS = 5;

    LinearStaking public immutable staking;
    MockERC20 public immutable stakingToken;
    MockERC20 public immutable rewardsToken;
    bool public immutable sameToken;

    address[] public actors;

    // Ghost ledgers, tracked from what the handler itself observed.
    uint256 public ghostStaked;
    uint256 public ghostFunded;
    uint256 public ghostPaid;

    constructor(bool sameToken_) {
        sameToken = sameToken_;
        stakingToken = new MockERC20("Stake Token", "STK", 18);
        rewardsToken = sameToken_ ? stakingToken : new MockERC20("Reward Token", "RWD", 18);
        staking = new LinearStaking(stakingToken, rewardsToken, address(this));
        for (uint256 i = 0; i < ACTORS; i++) {
            actors.push(makeAddr(string.concat("actor", vm.toString(i))));
        }
    }

    function actorCount() external pure returns (uint256) {
        return ACTORS;
    }

    function stake(uint256 actorSeed, uint256 amount) external {
        if (staking.paused()) return;
        address actor = actors[actorSeed % ACTORS];
        amount = bound(amount, 1, 1e30);

        stakingToken.mint(actor, amount);
        vm.startPrank(actor);
        stakingToken.approve(address(staking), amount);
        staking.stake(amount);
        vm.stopPrank();
        ghostStaked += amount;
    }

    /// Deliberately not skipped while paused: principal must always be withdrawable.
    function unstake(uint256 actorSeed, uint256 amount) external {
        address actor = actors[actorSeed % ACTORS];
        uint256 staked = staking.stakedBalance(actor);
        if (staked == 0) return;
        amount = bound(amount, 1, staked);

        uint256 balanceBefore = stakingToken.balanceOf(actor);
        vm.prank(actor);
        staking.unstake(amount);
        assertEq(stakingToken.balanceOf(actor) - balanceBefore, amount, "unstake returned a wrong amount");
        ghostStaked -= amount;
    }

    function claim(uint256 actorSeed) external {
        if (staking.paused()) return;
        address actor = actors[actorSeed % ACTORS];

        uint256 expected = staking.earned(actor);
        uint256 balanceBefore = rewardsToken.balanceOf(actor);
        vm.prank(actor);
        uint256 paid = staking.claim();
        assertEq(paid, expected, "claim paid something other than earned()");
        assertEq(rewardsToken.balanceOf(actor) - balanceBefore, paid, "claim transferred a wrong amount");
        ghostPaid += paid;
    }

    function exit(uint256 actorSeed) external {
        if (staking.paused()) return;
        address actor = actors[actorSeed % ACTORS];
        uint256 staked = staking.stakedBalance(actor);
        if (staked == 0) return;

        vm.prank(actor);
        (uint256 amount, uint256 paid) = staking.exit();
        assertEq(amount, staked, "exit returned a wrong stake");
        ghostStaked -= amount;
        ghostPaid += paid;
    }

    function fund(uint256 amount, uint256 duration) external {
        amount = bound(amount, 1, 1e27);
        duration = bound(duration, staking.MIN_REWARD_DURATION(), 90 days);

        rewardsToken.mint(address(this), amount);
        rewardsToken.approve(address(staking), amount);
        staking.fundRewards(amount, duration);
        ghostFunded += amount;
    }

    function warp(uint256 secondsForward) external {
        vm.warp(block.timestamp + bound(secondsForward, 1, 10 days));
    }

    function togglePause() external {
        if (staking.paused()) staking.unpause();
        else staking.pause();
    }
}

/// @notice Stateful invariant tests (Foundry style, run natively by Hardhat 3).
abstract contract LinearStakingInvariants is Test {
    uint256 private constant RATE_PRECISION = 1e18;

    StakingHandler internal handler;
    LinearStaking internal staking;

    function _setUp(bool sameToken) internal {
        handler = new StakingHandler(sameToken);
        staking = handler.staking();
        targetContract(address(handler));
    }

    function _sumOverActors() private view returns (uint256 stakes, uint256 accrued) {
        uint256 count = handler.actorCount();
        for (uint256 i = 0; i < count; i++) {
            address actor = handler.actors(i);
            stakes += staking.stakedBalance(actor);
            accrued += staking.earned(actor);
        }
    }

    /// I1: the sum of all staked balances equals totalStaked (and the handler's own count).
    function invariant_SumOfStakesEqualsTotalStaked() public view {
        (uint256 stakes, ) = _sumOverActors();
        assertEq(stakes, staking.totalStaked());
        assertEq(stakes, handler.ghostStaked());
    }

    /// I2: rewards paid never exceed rewards funded, on the ledgers and as observed.
    function invariant_PaidNeverExceedsFunded() public view {
        assertLe(staking.totalRewardsPaid(), staking.totalRewardsFunded());
        assertEq(staking.totalRewardsFunded(), handler.ghostFunded());
        assertEq(staking.totalRewardsPaid(), handler.ghostPaid());
    }

    /// I3: the reserve covers accrued rewards + what the rate will still emit + unallocated.
    function invariant_ReserveCoversEveryPromise() public view {
        (, uint256 accrued) = _sumOverActors();
        uint256 periodFinish = staking.periodFinish();
        uint256 remaining = periodFinish > block.timestamp ? periodFinish - block.timestamp : 0;
        uint256 promised = accrued * RATE_PRECISION + remaining * staking.rewardRate() + staking.unallocatedRewards();
        assertLe(promised, staking.rewardReserve() * RATE_PRECISION);
    }

    /// I4: the pool holds exactly principal + reward reserve; nothing leaks, nothing is created.
    function invariant_PoolHoldsPrincipalPlusReserve() public view {
        uint256 principal = staking.totalStaked();
        uint256 reserve = staking.rewardReserve();
        if (handler.sameToken()) {
            assertEq(handler.stakingToken().balanceOf(address(staking)), principal + reserve);
        } else {
            assertEq(handler.stakingToken().balanceOf(address(staking)), principal);
            assertEq(handler.rewardsToken().balanceOf(address(staking)), reserve);
        }
    }
}

contract LinearStakingTwoTokenInvariantTest is LinearStakingInvariants {
    function setUp() public {
        _setUp(false);
    }
}

contract LinearStakingSameTokenInvariantTest is LinearStakingInvariants {
    function setUp() public {
        _setUp(true);
    }
}

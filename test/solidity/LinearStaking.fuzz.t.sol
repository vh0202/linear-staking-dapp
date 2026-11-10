// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {LinearStaking} from "../../contracts/LinearStaking.sol";
import {MockERC20} from "../../contracts/mocks/MockERC20.sol";

/// @title Fuzz tests of the reward maths over the whole numeric domain
/// @notice Stakes from 1 wei to 2**128 - 1, rewards from 1 wei to the lifetime cap, every
///         allowed duration. The TypeScript suite checks behaviour with realistic amounts
///         and an exact reference model; these tests check that the same maths neither
///         overflows nor overpays at the extremes.
///
///         Stated rounding bound used below: an account's rewards are rounded down by
///         less than 1 wei per settlement or read, plus `stake / 1e36` wei per accumulator
///         update (zero for any stake below 1e36 wei), plus the sub-wei reward-rate remainder.
contract LinearStakingFuzzTest is Test {
    uint256 private constant ACC_PRECISION = 1e36;
    uint256 private constant MAX_STAKE = type(uint128).max;

    MockERC20 private stakingToken;
    MockERC20 private rewardsToken;
    LinearStaking private staking;

    address private immutable ALICE = makeAddr("alice");
    address private immutable BOB = makeAddr("bob");

    uint256 private maxRewards;
    uint256 private minDuration;
    uint256 private maxDuration;

    function setUp() public {
        stakingToken = new MockERC20("Stake Token", "STK", 18);
        rewardsToken = new MockERC20("Reward Token", "RWD", 18);
        staking = new LinearStaking(stakingToken, rewardsToken, address(this));

        maxRewards = staking.MAX_TOTAL_REWARDS();
        minDuration = staking.MIN_REWARD_DURATION();
        maxDuration = staking.MAX_REWARD_DURATION();
    }

    /*//////////////////////////////////////////////////////////////
                                 HELPERS
    //////////////////////////////////////////////////////////////*/

    function _stake(LinearStaking pool, MockERC20 token, address account, uint256 amount) private {
        token.mint(account, amount);
        vm.startPrank(account);
        token.approve(address(pool), amount);
        pool.stake(amount);
        vm.stopPrank();
    }

    function _fund(LinearStaking pool, MockERC20 token, uint256 amount, uint256 duration) private {
        token.mint(address(this), amount);
        token.approve(address(pool), amount);
        pool.fundRewards(amount, duration);
    }

    /*//////////////////////////////////////////////////////////////
                                  TESTS
    //////////////////////////////////////////////////////////////*/

    /// A lone staker earns `reward * elapsed / duration`: never more, and less only by dust.
    function testFuzz_SingleStakerAccruesLinearly(
        uint256 stake,
        uint256 reward,
        uint256 duration,
        uint256 elapsed
    ) public {
        stake = bound(stake, 1, MAX_STAKE);
        reward = bound(reward, 1, maxRewards);
        duration = bound(duration, minDuration, maxDuration);
        elapsed = bound(elapsed, 0, duration * 2); // during the period and after its end

        _stake(staking, stakingToken, ALICE, stake);
        _fund(staking, rewardsToken, reward, duration);
        vm.warp(block.timestamp + elapsed);

        uint256 emittedSeconds = elapsed < duration ? elapsed : duration;
        uint256 exact = Math.mulDiv(reward, emittedSeconds, duration); // rounded down, no overflow
        uint256 earned = staking.earned(ALICE);

        assertLe(earned, exact, "earned more than was emitted");
        assertLe(exact - earned, 2 + stake / ACC_PRECISION, "rounded down by more than the stated dust");

        // Whatever was earned can be claimed, and the stake can be withdrawn in full.
        vm.startPrank(ALICE);
        assertEq(staking.claim(), earned);
        staking.unstake(stake);
        vm.stopPrank();
        assertEq(rewardsToken.balanceOf(ALICE), earned);
        assertEq(stakingToken.balanceOf(ALICE), stake);
        assertEq(staking.rewardReserve(), reward - earned);
    }

    /// Two stakers present for the whole period share it pro rata; together never above funded.
    function testFuzz_TwoStakersShareProRata(
        uint256 stakeA,
        uint256 stakeB,
        uint256 reward,
        uint256 duration
    ) public {
        stakeA = bound(stakeA, 1, MAX_STAKE);
        stakeB = bound(stakeB, 1, MAX_STAKE);
        reward = bound(reward, 1, maxRewards);
        duration = bound(duration, minDuration, maxDuration);

        _stake(staking, stakingToken, ALICE, stakeA);
        _stake(staking, stakingToken, BOB, stakeB);
        _fund(staking, rewardsToken, reward, duration);
        vm.warp(block.timestamp + duration);

        uint256 total = stakeA + stakeB;
        uint256 exactA = Math.mulDiv(reward, stakeA, total);
        uint256 exactB = Math.mulDiv(reward, stakeB, total);
        uint256 earnedA = staking.earned(ALICE);
        uint256 earnedB = staking.earned(BOB);

        assertLe(earnedA, exactA, "alice earned more than her share");
        assertLe(earnedB, exactB, "bob earned more than his share");
        assertLe(exactA - earnedA, 2 + stakeA / ACC_PRECISION, "alice lost more than dust");
        assertLe(exactB - earnedB, 2 + stakeB / ACC_PRECISION, "bob lost more than dust");
        assertLe(earnedA + earnedB, reward, "paid out more than was funded");
    }

    /// A top-up, during the first period or after it, neither creates nor destroys rewards.
    function testFuzz_TopUpConservesRewards(
        uint256 stake,
        uint256 first,
        uint256 second,
        uint256 firstDuration,
        uint256 secondDuration,
        uint256 topUpAfter
    ) public {
        stake = bound(stake, 1, MAX_STAKE);
        first = bound(first, 1, maxRewards / 2);
        second = bound(second, 1, maxRewards / 2);
        firstDuration = bound(firstDuration, minDuration, maxDuration);
        secondDuration = bound(secondDuration, minDuration, maxDuration);
        topUpAfter = bound(topUpAfter, 0, firstDuration * 2);

        _stake(staking, stakingToken, ALICE, stake);
        _fund(staking, rewardsToken, first, firstDuration);
        vm.warp(block.timestamp + topUpAfter);
        _fund(staking, rewardsToken, second, secondDuration);
        vm.warp(block.timestamp + secondDuration);

        // Alice was staked the whole time, so she is owed everything that was funded.
        uint256 funded = first + second;
        uint256 earned = staking.earned(ALICE);
        assertLe(earned, funded, "earned more than was funded");
        assertLe(funded - earned, 4 + 2 * (stake / ACC_PRECISION), "lost more than dust");

        vm.prank(ALICE);
        (uint256 returnedStake, uint256 paid) = staking.exit();
        assertEq(returnedStake, stake);
        assertEq(paid, earned);
        assertEq(rewardsToken.balanceOf(address(staking)), funded - earned);
    }

    /// Principal can be withdrawn in any state: mid-period, after it, paused or not.
    function testFuzz_PrincipalIsAlwaysWithdrawable(
        uint256 stake,
        uint256 reward,
        uint256 duration,
        uint256 elapsed,
        uint256 withdrawal,
        bool paused
    ) public {
        stake = bound(stake, 1, MAX_STAKE);
        reward = bound(reward, 1, maxRewards);
        duration = bound(duration, minDuration, maxDuration);
        elapsed = bound(elapsed, 0, duration * 2);
        withdrawal = bound(withdrawal, 1, stake);

        _stake(staking, stakingToken, ALICE, stake);
        _fund(staking, rewardsToken, reward, duration);
        vm.warp(block.timestamp + elapsed);
        if (paused) staking.pause();

        vm.prank(ALICE);
        staking.unstake(withdrawal);

        assertEq(stakingToken.balanceOf(ALICE), withdrawal);
        assertEq(staking.stakedBalance(ALICE), stake - withdrawal);
        assertEq(staking.totalStaked(), stake - withdrawal);
    }

    /// One token for stake and rewards: after every reward is paid, principal is still there.
    function testFuzz_SameTokenRewardsNeverTouchPrincipal(
        uint256 stakeA,
        uint256 stakeB,
        uint256 reward,
        uint256 duration,
        uint256 elapsed
    ) public {
        stakeA = bound(stakeA, 1, MAX_STAKE);
        stakeB = bound(stakeB, 1, MAX_STAKE);
        reward = bound(reward, 1, maxRewards);
        duration = bound(duration, minDuration, maxDuration);
        elapsed = bound(elapsed, 0, duration * 2);

        MockERC20 token = new MockERC20("Single Token", "ONE", 18);
        LinearStaking pool = new LinearStaking(token, token, address(this));

        _stake(pool, token, ALICE, stakeA);
        _stake(pool, token, BOB, stakeB);
        _fund(pool, token, reward, duration);
        vm.warp(block.timestamp + elapsed);

        vm.prank(ALICE);
        uint256 paidA = pool.claim();
        vm.prank(BOB);
        uint256 paidB = pool.claim();

        // Rewards came out of the funded amount only...
        assertLe(paidA + paidB, reward, "paid out more than was funded");
        assertEq(token.balanceOf(address(pool)), stakeA + stakeB + reward - paidA - paidB);
        assertGe(token.balanceOf(address(pool)), stakeA + stakeB, "principal was used to pay rewards");

        // ...so both stakers get their whole principal back.
        vm.prank(ALICE);
        pool.unstake(stakeA);
        vm.prank(BOB);
        pool.unstake(stakeB);
        assertEq(token.balanceOf(ALICE), stakeA + paidA);
        assertEq(token.balanceOf(BOB), stakeB + paidB);
    }
}

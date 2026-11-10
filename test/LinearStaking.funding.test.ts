import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAddress, maxUint256 } from "viem";

import {
  assertWithin,
  createTestEnv,
  DAY,
  HOUR,
  MAX_REWARD_DURATION,
  MAX_TOTAL_REWARDS,
  MIN_REWARD_DURATION,
  ONE,
  OWNER_FUNDS,
  RATE_PRECISION,
  USER_FUNDS,
} from "../test-helpers/env.js";
import { assertPoolInvariants } from "../test-helpers/invariants.js";

describe("LinearStaking: funding the reward pool", async function () {
  const env = await createTestEnv();
  const { viem, networkHelpers, owner, alice, bob, carol, eve, at, warpTo, timelineStart } = env;

  const load = () => networkHelpers.loadFixture(env.twoTokenPool);
  const loadSameToken = () => networkHelpers.loadFixture(env.sameTokenPool);
  const addr = (wallet: typeof alice) => getAddress(wallet.account.address);

  describe("access and validation", function () {
    it("only the owner can fund", async function () {
      const { staking } = await load();

      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.fundRewards([1_000n * ONE, DAY], { account: alice.account }),
        staking,
        "OwnableUnauthorizedAccount",
        [addr(alice)],
      );
    });

    it("rejects a zero amount", async function () {
      const { staking } = await load();

      await viem.assertions.revertWithCustomError(staking.write.fundRewards([0n, DAY]), staking, "ZeroAmount");
    });

    it("rejects durations outside [1 hour, 5 years] and accepts both bounds", async function () {
      const { staking } = await load();

      for (const duration of [0n, 1n, MIN_REWARD_DURATION - 1n, MAX_REWARD_DURATION + 1n, maxUint256]) {
        await viem.assertions.revertWithCustomErrorWithArgs(
          staking.write.fundRewards([1_000n * ONE, duration]),
          staking,
          "InvalidDuration",
          [duration],
        );
      }

      await staking.write.fundRewards([1_000n * ONE, MIN_REWARD_DURATION]);
      await staking.write.fundRewards([1_000n * ONE, MAX_REWARD_DURATION]);
    });

    it("cannot promise rewards without transferring them", async function () {
      const { staking, rewardsToken } = await load();

      // No allowance: the pool cannot pull the tokens, so no rate is set.
      await rewardsToken.write.approve([staking.address, 0n]);
      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.fundRewards([1_000n * ONE, DAY]),
        rewardsToken,
        "ERC20InsufficientAllowance",
        [getAddress(staking.address), 0n, 1_000n * ONE],
      );

      // Allowance but not enough tokens.
      await rewardsToken.write.approve([staking.address, maxUint256]);
      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.fundRewards([OWNER_FUNDS + 1n, DAY]),
        rewardsToken,
        "ERC20InsufficientBalance",
        [addr(owner), OWNER_FUNDS, OWNER_FUNDS + 1n],
      );

      assert.equal(await staking.read.rewardRate(), 0n);
      assert.equal(await staking.read.periodFinish(), 0n);
      assert.equal(await staking.read.totalRewardsFunded(), 0n);
    });
  });

  describe("starting a period", function () {
    it("pulls the tokens, sets the schedule and emits RewardsFunded", async function () {
      const { staking, rewardsToken } = await load();
      const start = await timelineStart();
      const amount = 10_000n * ONE;
      const duration = 7n * DAY;

      const hash = await at(start, () => staking.write.fundRewards([amount, duration]));

      const expectedRate = (amount * RATE_PRECISION) / duration;
      await viem.assertions.emitWithArgs(hash, staking, "RewardsFunded", [
        addr(owner),
        amount,
        duration,
        expectedRate,
        start + duration,
      ]);
      assert.equal(await staking.read.rewardRate(), expectedRate);
      assert.equal(await staking.read.periodFinish(), start + duration);
      assert.equal(await staking.read.lastUpdateTime(), start);
      assert.equal(await staking.read.totalRewardsFunded(), amount);
      assert.equal(await staking.read.rewardReserve(), amount);
      assert.equal(await rewardsToken.read.balanceOf([staking.address]), amount);
      assert.equal(await rewardsToken.read.balanceOf([addr(owner)]), OWNER_FUNDS - amount);
    });

    it("keeps the division remainder: rate * duration + unallocated == amount", async function () {
      const { staking } = await load();
      const amount = 10_000n * ONE + 1n;
      const duration = 7n * DAY + 13n;

      await staking.write.fundRewards([amount, duration]);

      const rate = await staking.read.rewardRate();
      const unallocated = await staking.read.unallocatedRewards();
      assert.equal(rate * duration + unallocated, amount * RATE_PRECISION);
      assert.ok(unallocated < duration, "the remainder is far below one wei of reward token");
    });
  });

  describe("topping up", function () {
    it("rolls the unspent part of a running period into the new one", async function () {
      const { staking } = await load();
      const start = await timelineStart();
      const first = 10_000n * ONE;
      const firstDuration = 10n * DAY;
      const second = 5_000n * ONE;
      const secondDuration = 20n * DAY;

      await staking.write.stake([100n * ONE], { account: alice.account });
      await at(start, () => staking.write.fundRewards([first, firstDuration]));
      const firstRate = await staking.read.rewardRate();
      const firstRemainder = await staking.read.unallocatedRewards();

      // A quarter of the first period has passed when the owner tops up.
      const topUpTime = start + firstDuration / 4n;
      const hash = await at(topUpTime, () => staking.write.fundRewards([second, secondDuration]));

      // Independent calculation of the new schedule.
      const secondsLeft = start + firstDuration - topUpTime;
      const pool = second * RATE_PRECISION + secondsLeft * firstRate + firstRemainder;
      const expectedRate = pool / secondDuration;

      assert.equal(await staking.read.rewardRate(), expectedRate);
      assert.equal(await staking.read.unallocatedRewards(), pool - expectedRate * secondDuration);
      assert.equal(await staking.read.periodFinish(), topUpTime + secondDuration);
      assert.equal(await staking.read.lastUpdateTime(), topUpTime);
      await viem.assertions.emitWithArgs(hash, staking, "RewardsFunded", [
        addr(owner),
        second,
        secondDuration,
        expectedRate,
        topUpTime + secondDuration,
      ]);

      // In plain numbers: 7,500 left over + 5,000 new = 12,500 tokens over 20 days.
      assertWithin(expectedRate, (12_500n * ONE * RATE_PRECISION) / secondDuration, 1n, "new rate");

      // What Alice earned in the first quarter is untouched by the top-up...
      assertWithin(await staking.read.earned([addr(alice)]), 2_500n * ONE, 1n, "alice at top-up");

      // ...and by the end of the new period she has earned everything that was ever funded.
      await warpTo(topUpTime + secondDuration);
      assertWithin(await staking.read.earned([addr(alice)]), 15_000n * ONE, 2n, "alice at the end");
      assert.equal(await staking.read.totalRewardsFunded(), 15_000n * ONE);
    });

    it("lets the owner re-pace a running period but not remove rewards from it", async function () {
      const { staking, rewardsToken } = await load();
      const start = await timelineStart();

      await staking.write.stake([100n * ONE], { account: alice.account });
      await at(start, () => staking.write.fundRewards([10_000n * ONE, 10n * DAY]));
      const fastRate = await staking.read.rewardRate();

      // One wei over the maximum duration stretches the remaining 9,000 tokens over 5 years.
      await at(start + DAY, () => staking.write.fundRewards([1n, MAX_REWARD_DURATION]));
      assert.ok((await staking.read.rewardRate()) < fastRate / 100n, "emission is much slower now");

      // The tokens are still in the pool and still reach the staker in full.
      assert.equal(await rewardsToken.read.balanceOf([staking.address]), 10_000n * ONE + 1n);
      await warpTo(start + DAY + MAX_REWARD_DURATION);
      assertWithin(await staking.read.earned([addr(alice)]), 10_000n * ONE + 1n, 2n, "alice");
    });

    it("starts from scratch once the previous period is over", async function () {
      const { staking } = await load();
      const start = await timelineStart();

      await staking.write.stake([100n * ONE], { account: alice.account });
      await at(start, () => staking.write.fundRewards([1_000n * ONE, DAY]));
      const firstRemainder = await staking.read.unallocatedRewards();

      // Two idle days after the first period ended.
      const secondStart = start + 3n * DAY;
      await at(secondStart, () => staking.write.fundRewards([600n * ONE, 2n * DAY]));

      // Nothing is left over from the finished period except its sub-wei remainder.
      assert.equal(
        await staking.read.rewardRate(),
        (600n * ONE * RATE_PRECISION + firstRemainder) / (2n * DAY),
      );
      assert.equal(await staking.read.periodFinish(), secondStart + 2n * DAY);
      // The idle gap emitted nothing.
      assertWithin(await staking.read.earned([addr(alice)]), 1_000n * ONE, 1n, "alice before period 2");

      await warpTo(secondStart + 2n * DAY);
      assertWithin(await staking.read.earned([addr(alice)]), 1_600n * ONE, 2n, "alice after period 2");
    });
  });

  describe("solvency: the rate never promises more than the pool holds", function () {
    it("two tokens: accrued + future rewards stay within the reward balance through top-ups and claims", async function () {
      const pool = await load();
      const { staking } = pool;
      const accounts = [addr(alice), addr(bob), addr(carol)];
      const start = await timelineStart();

      await staking.write.stake([100n * ONE], { account: alice.account });
      await at(start, () => staking.write.fundRewards([10_000n * ONE + 3n, 7n * DAY]));
      await assertPoolInvariants(env, pool, accounts);

      await at(start + DAY, () => staking.write.stake([250n * ONE], { account: bob.account }));
      await at(start + 2n * DAY, () => staking.write.fundRewards([3_333n * ONE, 11n * DAY + 7n]));
      await assertPoolInvariants(env, pool, accounts);

      await at(start + 3n * DAY, () => staking.write.claim({ account: alice.account }));
      await at(start + 4n * DAY, () => staking.write.fundRewards([1n, MIN_REWARD_DURATION]));
      await at(start + 4n * DAY + 60n, () => staking.write.stake([1n], { account: carol.account }));
      await assertPoolInvariants(env, pool, accounts);

      await warpTo(start + 30n * DAY);
      const { accrued, heldRewards } = await assertPoolInvariants(env, pool, accounts);
      assert.ok(accrued <= heldRewards);
    });

    it("same token: principal is never counted as rewards", async function () {
      const pool = await loadSameToken();
      const { staking, stakingToken } = pool;
      const accounts = [addr(alice), addr(bob)];
      const start = await timelineStart();

      // 1,500,000 tokens of principal sit in the pool before any reward is funded.
      await staking.write.stake([USER_FUNDS], { account: alice.account });
      await staking.write.stake([USER_FUNDS / 2n], { account: bob.account });
      const principal = (USER_FUNDS * 3n) / 2n;

      await at(start, () => staking.write.fundRewards([900n * ONE, DAY]));

      // The rate comes from the 900 tokens that were funded, not from the pool's balance.
      assert.equal(await staking.read.rewardRate(), (900n * ONE * RATE_PRECISION) / DAY);
      assert.equal(await staking.read.rewardReserve(), 900n * ONE);
      assert.equal(await stakingToken.read.balanceOf([staking.address]), principal + 900n * ONE);
      await assertPoolInvariants(env, pool, accounts);

      // After the period everyone claims: only funded rewards leave the pool (2:1 by stake).
      await warpTo(start + DAY);
      await staking.write.claim({ account: alice.account });
      await staking.write.claim({ account: bob.account });
      const alicePaid = await stakingToken.read.balanceOf([addr(alice)]); // she staked all she had
      const bobPaid = (await stakingToken.read.balanceOf([addr(bob)])) - USER_FUNDS / 2n;
      assertWithin(alicePaid, 600n * ONE, 1n, "alice's reward");
      assertWithin(bobPaid, 300n * ONE, 1n, "bob's reward");
      const dust = 900n * ONE - alicePaid - bobPaid;
      assert.ok(dust >= 0n && dust <= 2n, `paid out ${dust} wei less than funded, never more`);

      const { heldStaking, totalStaked, reserve } = await assertPoolInvariants(env, pool, accounts);
      assert.equal(totalStaked, principal);
      assert.equal(reserve, dust);
      assert.equal(heldStaking, principal + dust, "the pool still holds every staked token");

      // And every staker can take out their full principal.
      await staking.write.unstake([USER_FUNDS], { account: alice.account });
      await staking.write.unstake([USER_FUNDS / 2n], { account: bob.account });
      assert.equal(await stakingToken.read.balanceOf([addr(alice)]), USER_FUNDS + alicePaid);
      assert.equal(await stakingToken.read.balanceOf([addr(bob)]), USER_FUNDS + bobPaid);
      assert.equal(await stakingToken.read.balanceOf([staking.address]), dust);
    });

    it("same token: the owner cannot start a period backed by stakers' deposits", async function () {
      const { staking, stakingToken } = await loadSameToken();
      await staking.write.stake([USER_FUNDS], { account: alice.account });

      // The pool holds 1,000,000 tokens, but none of them are rewards. Funding must bring
      // its own tokens: with no allowance it fails, and no rate is set.
      await stakingToken.write.approve([staking.address, 0n]);
      await viem.assertions.revertWithCustomError(
        staking.write.fundRewards([1_000n * ONE, DAY]),
        stakingToken,
        "ERC20InsufficientAllowance",
      );
      assert.equal(await staking.read.rewardRate(), 0n);
      assert.equal(await staking.read.rewardReserve(), 0n);
    });

    it("a payout larger than the reward reserve reverts, so a ledger bug cannot drain principal", async function () {
      const { staking, stakingToken } = await networkHelpers.loadFixture(env.sameTokenHarnessPool);
      const start = await timelineStart();

      await staking.write.stake([1_000n * ONE], { account: alice.account });
      await at(start, () => staking.write.fundRewards([100n * ONE, HOUR]));

      // Simulate a bug in the reward maths: Bob is credited 500 tokens he never earned.
      // The pool holds 1,100 tokens, so an unguarded transfer would succeed and would be
      // paid out of Alice's principal.
      await staking.write.harnessCreditRewards([addr(bob), 500n * ONE]);

      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.claim({ account: bob.account }),
        staking,
        "RewardExceedsReserve",
        [500n * ONE, 100n * ONE],
      );

      // The same guard protects exit(); unstake() pays no rewards and still works.
      await staking.write.stake([10n * ONE], { account: bob.account });
      await viem.assertions.revertWithCustomError(
        staking.write.exit({ account: bob.account }),
        staking,
        "RewardExceedsReserve",
      );
      await staking.write.unstake([10n * ONE], { account: bob.account });

      // Alice's principal is intact.
      await staking.write.unstake([1_000n * ONE], { account: alice.account });
      assert.equal(await stakingToken.read.balanceOf([addr(alice)]), USER_FUNDS);
    });

    it("ignores tokens that are sent to the pool directly", async function () {
      const { staking, rewardsToken } = await load();
      const start = await timelineStart();

      await staking.write.stake([100n * ONE], { account: alice.account });
      await at(start, () => staking.write.fundRewards([1_000n * ONE, DAY]));
      const rate = await staking.read.rewardRate();

      await rewardsToken.write.transfer([staking.address, 500n * ONE]); // not through fundRewards

      assert.equal(await staking.read.rewardRate(), rate);
      assert.equal(await staking.read.totalRewardsFunded(), 1_000n * ONE);
      assert.equal(await staking.read.rewardReserve(), 1_000n * ONE);
      await warpTo(start + DAY);
      assertWithin(await staking.read.earned([addr(alice)]), 1_000n * ONE, 1n, "alice");
    });
  });

  describe("unsupported tokens are rejected, not mis-accounted", function () {
    it("a fee-on-transfer reward token cannot fund a period", async function () {
      const stakingToken = await viem.deployContract("MockERC20", ["Stake Token", "STK", 18]);
      const feeToken = await viem.deployContract("MockFeeOnTransferERC20", [100n]); // 1% fee
      const staking = await viem.deployContract("LinearStaking", [stakingToken.address, feeToken.address, addr(owner)]);
      await feeToken.write.mint([addr(owner), 1_000n * ONE]);
      await feeToken.write.approve([staking.address, maxUint256]);

      // 100 requested, 99 arrive: the pool would owe more rewards than it holds.
      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.fundRewards([100n * ONE, DAY]),
        staking,
        "InsufficientTokenBalance",
        [getAddress(feeToken.address), 99n * ONE, 100n * ONE],
      );
      assert.equal(await staking.read.rewardRate(), 0n);
    });

    it("same token: principal does not hide a funding shortfall", async function () {
      const feeToken = await viem.deployContract("MockFeeOnTransferERC20", [0n]); // fee off at first
      const staking = await viem.deployContract("LinearStaking", [feeToken.address, feeToken.address, addr(owner)]);
      await feeToken.write.mint([addr(alice), 1_000n * ONE]);
      await feeToken.write.mint([addr(owner), 1_000n * ONE]);
      await feeToken.write.approve([staking.address, maxUint256], { account: alice.account });
      await feeToken.write.approve([staking.address, maxUint256]);

      await staking.write.stake([1_000n * ONE], { account: alice.account });
      await feeToken.write.setFeeBps([100n]); // the token starts charging 1%

      // The pool would hold 1,099 tokens: plenty for the 100 of rewards if principal were
      // counted, but 1 short of principal + rewards.
      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.fundRewards([100n * ONE, DAY]),
        staking,
        "InsufficientTokenBalance",
        [getAddress(feeToken.address), 1_099n * ONE, 1_100n * ONE],
      );

      // Alice can still take out everything she put in.
      await feeToken.write.setFeeBps([0n]);
      await staking.write.unstake([1_000n * ONE], { account: alice.account });
      assert.equal(await feeToken.read.balanceOf([addr(alice)]), 1_000n * ONE);
    });

    it("a fee-on-transfer staking token cannot be staked", async function () {
      const feeToken = await viem.deployContract("MockFeeOnTransferERC20", [250n]); // 2.5% fee
      const rewardsToken = await viem.deployContract("MockERC20", ["Reward Token", "RWD", 18]);
      const staking = await viem.deployContract("LinearStaking", [feeToken.address, rewardsToken.address, addr(owner)]);
      await feeToken.write.mint([addr(alice), 1_000n * ONE]);
      await feeToken.write.approve([staking.address, maxUint256], { account: alice.account });

      // 400 credited, 390 received.
      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.stake([400n * ONE], { account: alice.account }),
        staking,
        "InsufficientTokenBalance",
        [getAddress(feeToken.address), 390n * ONE, 400n * ONE],
      );
      assert.equal(await staking.read.totalStaked(), 0n);
      assert.equal(await feeToken.read.balanceOf([addr(alice)]), 1_000n * ONE);
    });
  });

  describe("lifetime cap and overflow bound", function () {
    it("rejects funding beyond the lifetime cap of 2^128 - 1", async function () {
      const { staking, rewardsToken } = await load();
      await rewardsToken.write.mint([addr(owner), MAX_TOTAL_REWARDS]);

      await staking.write.fundRewards([1_000n * ONE, DAY]);
      const available = MAX_TOTAL_REWARDS - 1_000n * ONE;

      for (const amount of [available + 1n, maxUint256]) {
        await viem.assertions.revertWithCustomErrorWithArgs(
          staking.write.fundRewards([amount, DAY]),
          staking,
          "RewardCapExceeded",
          [amount, available],
        );
      }

      // Exactly the remaining headroom is accepted; after that nothing more.
      await staking.write.fundRewards([available, DAY]);
      assert.equal(await staking.read.totalRewardsFunded(), MAX_TOTAL_REWARDS);
      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.fundRewards([1n, DAY]),
        staking,
        "RewardCapExceeded",
        [1n, 0n],
      );
    });

    it("does not overflow at the cap, even with a single wei staked", async function () {
      const pool = await load();
      const { staking, stakingToken, rewardsToken } = pool;
      const start = await timelineStart();
      await rewardsToken.write.mint([addr(owner), MAX_TOTAL_REWARDS]);

      // Worst case for the accumulator: the largest possible reward, the shortest possible
      // period, and the smallest possible total stake.
      await staking.write.stake([1n], { account: alice.account });
      await at(start, () => staking.write.fundRewards([MAX_TOTAL_REWARDS, MIN_REWARD_DURATION]));

      // A large staker joins half way; from then on Alice's 1 wei earns next to nothing.
      await at(start + MIN_REWARD_DURATION / 2n, () => staking.write.stake([USER_FUNDS], { account: bob.account }));
      await warpTo(start + MIN_REWARD_DURATION);

      const accumulator = await staking.read.rewardPerToken();
      assert.ok(accumulator > 10n ** 74n, "the accumulator really is near its documented bound");
      assert.ok(accumulator < MAX_TOTAL_REWARDS * 10n ** 36n, "and below funded * ACC_PRECISION < 2^256");

      const half = MAX_TOTAL_REWARDS / 2n;
      assertWithin(await staking.read.earned([addr(alice)]), half, 10n ** 15n, "alice");
      assertWithin(await staking.read.earned([addr(bob)]), half, 10n ** 15n, "bob");
      await assertPoolInvariants(env, pool, [addr(alice), addr(bob)]);

      // Claiming and unstaking keep working at these magnitudes.
      await staking.write.claim({ account: alice.account });
      await staking.write.exit({ account: bob.account });
      await staking.write.unstake([1n], { account: alice.account });

      const paid = await staking.read.totalRewardsPaid();
      assert.ok(paid <= MAX_TOTAL_REWARDS && MAX_TOTAL_REWARDS - paid <= 4n, "paid everything but dust");
      assert.equal(await stakingToken.read.balanceOf([staking.address]), 0n);
      assert.equal(await staking.read.earned([addr(eve)]), 0n);
    });
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAddress, maxUint256, zeroAddress } from "viem";

import {
  ACC_PRECISION,
  createTestEnv,
  HOUR,
  MAX_REWARD_DURATION,
  MAX_TOTAL_REWARDS,
  MIN_REWARD_DURATION,
  ONE,
  RATE_PRECISION,
  USER_FUNDS,
} from "../test-helpers/env.js";

describe("LinearStaking: deployment, stake, unstake, claim, exit", async function () {
  const env = await createTestEnv();
  const { viem, networkHelpers, publicClient, owner, alice, bob, eve, at, timelineStart } = env;

  const load = () => networkHelpers.loadFixture(env.twoTokenPool);
  const addr = (wallet: typeof alice) => getAddress(wallet.account.address);

  /**
   * Alice stakes 100 tokens, then the owner starts a period that emits exactly 1 reward
   * token per second for one hour (3600 tokens / 3600 s), beginning at the returned time.
   */
  async function aliceStakedAndFunded() {
    const pool = await load();
    const start = await timelineStart();
    await pool.staking.write.stake([100n * ONE], { account: alice.account });
    await at(start, () => pool.staking.write.fundRewards([3_600n * ONE, HOUR]));
    return { ...pool, start };
  }

  describe("deployment", function () {
    it("stores the tokens and the owner, and starts empty and unpaused", async function () {
      const { staking, stakingToken, rewardsToken } = await load();

      assert.equal(getAddress(await staking.read.stakingToken()), getAddress(stakingToken.address));
      assert.equal(getAddress(await staking.read.rewardsToken()), getAddress(rewardsToken.address));
      assert.equal(getAddress(await staking.read.owner()), addr(owner));
      assert.equal(await staking.read.pendingOwner(), zeroAddress);
      assert.equal(await staking.read.paused(), false);

      assert.equal(await staking.read.totalStaked(), 0n);
      assert.equal(await staking.read.rewardRate(), 0n);
      assert.equal(await staking.read.periodFinish(), 0n);
      assert.equal(await staking.read.lastUpdateTime(), 0n);
      assert.equal(await staking.read.rewardPerTokenStored(), 0n);
      assert.equal(await staking.read.rewardPerToken(), 0n);
      assert.equal(await staking.read.unallocatedRewards(), 0n);
      assert.equal(await staking.read.totalRewardsFunded(), 0n);
      assert.equal(await staking.read.totalRewardsPaid(), 0n);
      assert.equal(await staking.read.rewardReserve(), 0n);
      assert.equal(await staking.read.earned([addr(alice)]), 0n);
    });

    it("exposes the documented constants", async function () {
      const { staking } = await load();

      assert.equal(await staking.read.RATE_PRECISION(), RATE_PRECISION);
      assert.equal(await staking.read.ACC_PRECISION(), ACC_PRECISION);
      assert.equal(await staking.read.MIN_REWARD_DURATION(), MIN_REWARD_DURATION);
      assert.equal(await staking.read.MAX_REWARD_DURATION(), MAX_REWARD_DURATION);
      assert.equal(await staking.read.MAX_TOTAL_REWARDS(), MAX_TOTAL_REWARDS);
    });

    it("rejects a zero staking token or reward token", async function () {
      const { staking, stakingToken } = await load();

      await viem.assertions.revertWithCustomError(
        viem.deployContract("LinearStaking", [zeroAddress, stakingToken.address, addr(owner)]),
        staking,
        "ZeroAddress",
      );
      await viem.assertions.revertWithCustomError(
        viem.deployContract("LinearStaking", [stakingToken.address, zeroAddress, addr(owner)]),
        staking,
        "ZeroAddress",
      );
    });

    it("rejects a zero owner", async function () {
      const { staking, stakingToken, rewardsToken } = await load();

      await viem.assertions.revertWithCustomErrorWithArgs(
        viem.deployContract("LinearStaking", [stakingToken.address, rewardsToken.address, zeroAddress]),
        staking,
        "OwnableInvalidOwner",
        [zeroAddress],
      );
    });
  });

  describe("stake", function () {
    it("moves the tokens into the pool, credits the staker and emits Staked", async function () {
      const { staking, stakingToken } = await load();
      const amount = 100n * ONE;

      const hash = await staking.write.stake([amount], { account: alice.account });

      await viem.assertions.emitWithArgs(hash, staking, "Staked", [addr(alice), amount]);
      assert.equal(await staking.read.stakedBalance([addr(alice)]), amount);
      assert.equal(await staking.read.totalStaked(), amount);
      assert.equal(await stakingToken.read.balanceOf([staking.address]), amount);
      assert.equal(await stakingToken.read.balanceOf([addr(alice)]), USER_FUNDS - amount);
    });

    it("adds to an existing stake and keeps a separate balance per staker", async function () {
      const { staking, stakingToken } = await load();

      await staking.write.stake([100n * ONE], { account: alice.account });
      await staking.write.stake([50n * ONE], { account: alice.account });
      await staking.write.stake([25n * ONE], { account: bob.account });

      assert.equal(await staking.read.stakedBalance([addr(alice)]), 150n * ONE);
      assert.equal(await staking.read.stakedBalance([addr(bob)]), 25n * ONE);
      assert.equal(await staking.read.totalStaked(), 175n * ONE);
      assert.equal(await stakingToken.read.balanceOf([staking.address]), 175n * ONE);
    });

    it("reverts for a zero amount", async function () {
      const { staking } = await load();

      await viem.assertions.revertWithCustomError(
        staking.write.stake([0n], { account: alice.account }),
        staking,
        "ZeroAmount",
      );
    });

    it("reverts when the pool has no allowance", async function () {
      const { staking, stakingToken } = await load();
      await stakingToken.write.mint([addr(eve), ONE]);

      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.stake([ONE], { account: eve.account }),
        stakingToken,
        "ERC20InsufficientAllowance",
        [getAddress(staking.address), 0n, ONE],
      );
    });

    it("reverts when the staker does not hold enough tokens", async function () {
      const { staking, stakingToken } = await load();
      await stakingToken.write.approve([staking.address, maxUint256], { account: eve.account });

      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.stake([ONE], { account: eve.account }),
        stakingToken,
        "ERC20InsufficientBalance",
        [addr(eve), 0n, ONE],
      );
      assert.equal(await staking.read.totalStaked(), 0n);
    });
  });

  describe("unstake", function () {
    it("returns part of the stake and emits Unstaked", async function () {
      const { staking, stakingToken } = await load();
      await staking.write.stake([100n * ONE], { account: alice.account });

      const hash = await staking.write.unstake([40n * ONE], { account: alice.account });

      await viem.assertions.emitWithArgs(hash, staking, "Unstaked", [addr(alice), 40n * ONE]);
      assert.equal(await staking.read.stakedBalance([addr(alice)]), 60n * ONE);
      assert.equal(await staking.read.totalStaked(), 60n * ONE);
      assert.equal(await stakingToken.read.balanceOf([staking.address]), 60n * ONE);
      assert.equal(await stakingToken.read.balanceOf([addr(alice)]), USER_FUNDS - 60n * ONE);
    });

    it("returns the full stake", async function () {
      const { staking, stakingToken } = await load();
      await staking.write.stake([100n * ONE], { account: alice.account });
      await staking.write.stake([30n * ONE], { account: bob.account });

      await staking.write.unstake([100n * ONE], { account: alice.account });

      assert.equal(await staking.read.stakedBalance([addr(alice)]), 0n);
      assert.equal(await staking.read.totalStaked(), 30n * ONE);
      assert.equal(await stakingToken.read.balanceOf([addr(alice)]), USER_FUNDS);
    });

    it("reverts for a zero amount", async function () {
      const { staking } = await load();
      await staking.write.stake([100n * ONE], { account: alice.account });

      await viem.assertions.revertWithCustomError(
        staking.write.unstake([0n], { account: alice.account }),
        staking,
        "ZeroAmount",
      );
    });

    it("reverts when unstaking more than staked, reporting both amounts", async function () {
      const { staking } = await load();
      await staking.write.stake([100n * ONE], { account: alice.account });
      await staking.write.stake([500n * ONE], { account: bob.account });

      // Bob's larger stake is in the pool, but Alice can only take out her own.
      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.unstake([100n * ONE + 1n], { account: alice.account }),
        staking,
        "InsufficientStake",
        [100n * ONE + 1n, 100n * ONE],
      );
      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.unstake([1n], { account: eve.account }),
        staking,
        "InsufficientStake",
        [1n, 0n],
      );
    });

    it("keeps the rewards accrued so far claimable", async function () {
      const { staking, rewardsToken, start } = await aliceStakedAndFunded();

      await at(start + 600n, () => staking.write.unstake([100n * ONE], { account: alice.account }));
      assert.equal(await staking.read.earned([addr(alice)]), 600n * ONE);

      // Nothing more accrues without a stake.
      await at(start + 1_200n, () => staking.write.claim({ account: alice.account }));
      assert.equal(await rewardsToken.read.balanceOf([addr(alice)]), 600n * ONE);
    });
  });

  describe("claim", function () {
    it("pays the accrued rewards, emits RewardPaid and updates the ledgers", async function () {
      const { staking, stakingToken, rewardsToken, start } = await aliceStakedAndFunded();
      const poolRewardsBefore = await rewardsToken.read.balanceOf([staking.address]);

      const hash = await at(start + 600n, () => staking.write.claim({ account: alice.account }));

      // 600 s at 1 token/s, and Alice is the only staker.
      await viem.assertions.emitWithArgs(hash, staking, "RewardPaid", [addr(alice), 600n * ONE]);
      assert.equal(await rewardsToken.read.balanceOf([addr(alice)]), 600n * ONE);
      assert.equal(await rewardsToken.read.balanceOf([staking.address]), poolRewardsBefore - 600n * ONE);
      assert.equal(await staking.read.totalRewardsPaid(), 600n * ONE);
      assert.equal(await staking.read.rewardReserve(), 3_000n * ONE);
      assert.equal(await staking.read.rewards([addr(alice)]), 0n);
      assert.equal(await staking.read.earned([addr(alice)]), 0n);

      // Claiming does not touch the stake.
      assert.equal(await staking.read.stakedBalance([addr(alice)]), 100n * ONE);
      assert.equal(await stakingToken.read.balanceOf([staking.address]), 100n * ONE);
    });

    it("returns the amount paid", async function () {
      const { staking, start } = await aliceStakedAndFunded();

      await networkHelpers.time.setNextBlockTimestamp(start + 900n);
      const { result } = await staking.simulate.claim({ account: addr(alice), blockTag: "pending" });

      assert.equal(result, 900n * ONE);
    });

    it("keeps accruing after a claim", async function () {
      const { staking, rewardsToken, start } = await aliceStakedAndFunded();

      await at(start + 600n, () => staking.write.claim({ account: alice.account }));
      await at(start + 1_500n, () => staking.write.claim({ account: alice.account }));

      assert.equal(await rewardsToken.read.balanceOf([addr(alice)]), 1_500n * ONE);
    });

    // Chosen behaviour: claiming with nothing accrued is a silent no-op, not an error.
    it("a second claim with nothing accrued pays zero and does not revert", async function () {
      const { staking, rewardsToken, start } = await aliceStakedAndFunded();

      // The period is over, so nothing accrues between the two claims.
      await at(start + HOUR + 10n, () => staking.write.claim({ account: alice.account }));
      const paidOnce = await rewardsToken.read.balanceOf([addr(alice)]);
      assert.equal(paidOnce, 3_600n * ONE);

      const { result } = await staking.simulate.claim({ account: addr(alice), blockTag: "pending" });
      assert.equal(result, 0n);

      const hash = await staking.write.claim({ account: alice.account });
      const receipt = await publicClient.getTransactionReceipt({ hash });

      assert.equal(receipt.status, "success");
      assert.equal(receipt.logs.length, 0, "no RewardPaid event and no token transfer");
      assert.equal(await rewardsToken.read.balanceOf([addr(alice)]), paidOnce);
      assert.equal(await staking.read.totalRewardsPaid(), paidOnce);
    });

    it("is a no-op for an account that never staked", async function () {
      const { staking, rewardsToken, start } = await aliceStakedAndFunded();

      const hash = await at(start + 600n, () => staking.write.claim({ account: eve.account }));
      const receipt = await publicClient.getTransactionReceipt({ hash });

      assert.equal(receipt.logs.length, 0);
      assert.equal(await rewardsToken.read.balanceOf([addr(eve)]), 0n);
      assert.equal(await staking.read.totalRewardsPaid(), 0n);
    });
  });

  describe("exit", function () {
    it("returns the whole stake and all rewards in one transaction", async function () {
      const { staking, stakingToken, rewardsToken, start } = await aliceStakedAndFunded();

      await networkHelpers.time.setNextBlockTimestamp(start + 1_800n);
      const { result } = await staking.simulate.exit({ account: addr(alice), blockTag: "pending" });
      assert.deepEqual(result, [100n * ONE, 1_800n * ONE]);

      const hash = await staking.write.exit({ account: alice.account });

      await viem.assertions.emitWithArgs(hash, staking, "Unstaked", [addr(alice), 100n * ONE]);
      await viem.assertions.emitWithArgs(hash, staking, "RewardPaid", [addr(alice), 1_800n * ONE]);
      assert.equal(await stakingToken.read.balanceOf([addr(alice)]), USER_FUNDS);
      assert.equal(await rewardsToken.read.balanceOf([addr(alice)]), 1_800n * ONE);
      assert.equal(await staking.read.stakedBalance([addr(alice)]), 0n);
      assert.equal(await staking.read.totalStaked(), 0n);
      assert.equal(await staking.read.earned([addr(alice)]), 0n);
      assert.equal(await staking.read.totalRewardsPaid(), 1_800n * ONE);
    });

    it("only returns the stake when nothing has accrued", async function () {
      const { staking, stakingToken, rewardsToken } = await load();
      await staking.write.stake([100n * ONE], { account: alice.account });

      const hash = await staking.write.exit({ account: alice.account });
      const receipt = await publicClient.getTransactionReceipt({ hash });

      await viem.assertions.emitWithArgs(hash, staking, "Unstaked", [addr(alice), 100n * ONE]);
      // Unstaked + the staking token's Transfer; no RewardPaid, no reward transfer.
      assert.equal(receipt.logs.length, 2);
      assert.equal(await stakingToken.read.balanceOf([addr(alice)]), USER_FUNDS);
      assert.equal(await rewardsToken.read.balanceOf([addr(alice)]), 0n);
    });

    it("reverts with ZeroAmount when the caller has nothing staked", async function () {
      const { staking, rewardsToken, start } = await aliceStakedAndFunded();

      await viem.assertions.revertWithCustomError(
        staking.write.exit({ account: eve.account }),
        staking,
        "ZeroAmount",
      );

      // Rewards without a stake are collected with claim(), not exit().
      await at(start + 600n, () => staking.write.unstake([100n * ONE], { account: alice.account }));
      await viem.assertions.revertWithCustomError(
        staking.write.exit({ account: alice.account }),
        staking,
        "ZeroAmount",
      );
      await staking.write.claim({ account: alice.account });
      assert.equal(await rewardsToken.read.balanceOf([addr(alice)]), 600n * ONE);
    });
  });
});

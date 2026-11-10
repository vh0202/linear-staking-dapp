import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeAbiParameters, encodeFunctionData, getAddress, maxUint256, toFunctionSelector, type Hex } from "viem";

import { createTestEnv, DAY, HOUR, ONE } from "../test-helpers/env.js";

/**
 * Reentrancy tests. `ReentrantERC20` is both the hostile token and the attacker: it holds a
 * stake itself and, when armed, calls back into the pool from inside its own transfer, the
 * way a token with transfer hooks (ERC-777 style) hands control to a recipient.
 */
describe("LinearStaking: reentrancy", async function () {
  const env = await createTestEnv();
  const { viem, networkHelpers, owner, at, timelineStart } = env;

  const GUARD_ERROR = toFunctionSelector("ReentrancyGuardReentrantCall()");

  /** The hostile token is the STAKING token and holds a stake of 100. */
  async function hostileStakingToken() {
    const evil = await viem.deployContract("ReentrantERC20");
    const rewardsToken = await viem.deployContract("MockERC20", ["Reward Token", "RWD", 18]);
    const staking = await viem.deployContract("LinearStaking", [
      evil.address,
      rewardsToken.address,
      owner.account.address,
    ]);
    const call = (functionName: "stake" | "unstake", amount: bigint) =>
      encodeFunctionData({ abi: staking.abi, functionName, args: [amount] });

    await evil.write.mint([evil.address, 1_000n * ONE]);
    await evil.write.execute([
      evil.address,
      encodeFunctionData({ abi: evil.abi, functionName: "approve", args: [staking.address, maxUint256] }),
    ]);
    await evil.write.execute([staking.address, call("stake", 100n * ONE)]);

    return { evil, staking, rewardsToken, call };
  }

  /** The hostile token is the REWARD token; it stakes 100 ordinary tokens and rewards are running. */
  async function hostileRewardsToken() {
    const stakingToken = await viem.deployContract("MockERC20", ["Stake Token", "STK", 18]);
    const evil = await viem.deployContract("ReentrantERC20");
    const staking = await viem.deployContract("LinearStaking", [
      stakingToken.address,
      evil.address,
      owner.account.address,
    ]);

    await stakingToken.write.mint([evil.address, 1_000n * ONE]);
    await evil.write.execute([
      stakingToken.address,
      encodeFunctionData({ abi: stakingToken.abi, functionName: "approve", args: [staking.address, maxUint256] }),
    ]);
    await evil.write.execute([
      staking.address,
      encodeFunctionData({ abi: staking.abi, functionName: "stake", args: [100n * ONE] }),
    ]);

    // 1 reward token per second for an hour, all of it going to the attacker's stake.
    const start = await timelineStart();
    await evil.write.mint([owner.account.address, 3_600n * ONE]);
    await evil.write.approve([staking.address, maxUint256]);
    await at(start, () => staking.write.fundRewards([3_600n * ONE, HOUR]));

    return { evil, staking, stakingToken, start };
  }

  describe("hostile staking token", function () {
    it("stake cannot be re-entered from the token's transferFrom", async function () {
      const { evil, staking, call } = await networkHelpers.loadFixture(hostileStakingToken);

      for (const reentry of [call("stake", 50n * ONE), call("unstake", 100n * ONE)]) {
        await evil.write.arm([staking.address, reentry, false]);
        await viem.assertions.revertWithCustomError(
          evil.write.execute([staking.address, call("stake", 10n * ONE)]),
          staking,
          "ReentrancyGuardReentrantCall",
        );
      }
      assert.equal(await staking.read.stakedBalance([evil.address]), 100n * ONE);
    });

    it("unstake cannot be re-entered to withdraw the same stake twice", async function () {
      const { evil, staking, call } = await networkHelpers.loadFixture(hostileStakingToken);
      const exit = encodeFunctionData({ abi: staking.abi, functionName: "exit" });
      const claim = encodeFunctionData({ abi: staking.abi, functionName: "claim" });

      // While the pool sends the attacker its 100 tokens, try every entry point again.
      for (const reentry of [call("unstake", 100n * ONE), exit, claim, call("stake", ONE)]) {
        await evil.write.arm([staking.address, reentry, false]);
        await viem.assertions.revertWithCustomError(
          evil.write.execute([staking.address, call("unstake", 100n * ONE)]),
          staking,
          "ReentrancyGuardReentrantCall",
        );
      }
      assert.equal(await staking.read.stakedBalance([evil.address]), 100n * ONE);
      assert.equal(await evil.read.balanceOf([staking.address]), 100n * ONE);
    });

    it("a swallowed re-entry gains nothing: the stake leaves the pool exactly once", async function () {
      const { evil, staking, call } = await networkHelpers.loadFixture(hostileStakingToken);

      // The token ignores the failed callback, so the outer unstake completes normally.
      await evil.write.arm([staking.address, call("unstake", 60n * ONE), true]);
      await evil.write.execute([staking.address, call("unstake", 60n * ONE)]);

      assert.equal(await evil.read.reentryAttempted(), true);
      assert.equal(await evil.read.reentrySucceeded(), false);
      assert.equal(await evil.read.reentryReturnData(), GUARD_ERROR);

      assert.equal(await staking.read.stakedBalance([evil.address]), 40n * ONE);
      assert.equal(await staking.read.totalStaked(), 40n * ONE);
      assert.equal(await evil.read.balanceOf([staking.address]), 40n * ONE);
      assert.equal(await evil.read.balanceOf([evil.address]), 960n * ONE);
    });

    it("state is final before the token is called (checks-effects-interactions)", async function () {
      const { evil, staking, call } = await networkHelpers.loadFixture(hostileStakingToken);

      // Read-only callbacks are not blocked by the guard. Each observation unstakes 30 of
      // the 100 staked and reads the pool from inside the token transfer: what it sees must
      // already be the state after that unstake.
      const observe = async (data: Hex) => {
        await evil.write.arm([staking.address, data, true]);
        await evil.write.execute([staking.address, call("unstake", 30n * ONE)]);
        assert.equal(await evil.read.reentrySucceeded(), true);
        return decodeAbiParameters([{ type: "uint256" }], await evil.read.reentryReturnData())[0];
      };

      const seenBalance = await observe(
        encodeFunctionData({ abi: staking.abi, functionName: "stakedBalance", args: [evil.address] }),
      );
      assert.equal(seenBalance, 70n * ONE);

      const seenTotal = await observe(encodeFunctionData({ abi: staking.abi, functionName: "totalStaked" }));
      assert.equal(seenTotal, 40n * ONE);
    });
  });

  describe("hostile reward token", function () {
    it("claim cannot be re-entered to be paid twice", async function () {
      const { evil, staking, start } = await networkHelpers.loadFixture(hostileRewardsToken);
      const claim = encodeFunctionData({ abi: staking.abi, functionName: "claim" });
      const exit = encodeFunctionData({ abi: staking.abi, functionName: "exit" });
      const unstake = encodeFunctionData({ abi: staking.abi, functionName: "unstake", args: [100n * ONE] });
      await networkHelpers.time.increaseTo(start + 600n);

      for (const reentry of [claim, exit, unstake]) {
        await evil.write.arm([staking.address, reentry, false]);
        await viem.assertions.revertWithCustomError(
          evil.write.execute([staking.address, claim]),
          staking,
          "ReentrancyGuardReentrantCall",
        );
      }
      assert.equal(await staking.read.totalRewardsPaid(), 0n);
    });

    it("exit cannot be re-entered during the reward payout", async function () {
      const { evil, staking, start } = await networkHelpers.loadFixture(hostileRewardsToken);
      const claim = encodeFunctionData({ abi: staking.abi, functionName: "claim" });
      const exit = encodeFunctionData({ abi: staking.abi, functionName: "exit" });
      await networkHelpers.time.increaseTo(start + 600n);

      for (const reentry of [claim, exit]) {
        await evil.write.arm([staking.address, reentry, false]);
        await viem.assertions.revertWithCustomError(
          evil.write.execute([staking.address, exit]),
          staking,
          "ReentrancyGuardReentrantCall",
        );
      }
      assert.equal(await staking.read.stakedBalance([evil.address]), 100n * ONE);
    });

    it("a swallowed re-entry gains nothing: rewards are paid exactly once", async function () {
      const { evil, staking, start } = await networkHelpers.loadFixture(hostileRewardsToken);
      const claim = encodeFunctionData({ abi: staking.abi, functionName: "claim" });

      await evil.write.arm([staking.address, claim, true]);
      await at(start + 600n, () => evil.write.execute([staking.address, claim]));

      assert.equal(await evil.read.reentryAttempted(), true);
      assert.equal(await evil.read.reentrySucceeded(), false);
      assert.equal(await evil.read.reentryReturnData(), GUARD_ERROR);

      // 600 s at 1 token/s, once.
      assert.equal(await evil.read.balanceOf([evil.address]), 600n * ONE);
      assert.equal(await staking.read.totalRewardsPaid(), 600n * ONE);
      assert.equal(await staking.read.rewards([evil.address]), 0n);
    });

    it("the reward ledger is already cleared when the reward token is called", async function () {
      const { evil, staking, start } = await networkHelpers.loadFixture(hostileRewardsToken);
      const claim = encodeFunctionData({ abi: staking.abi, functionName: "claim" });

      await evil.write.arm([
        staking.address,
        encodeFunctionData({ abi: staking.abi, functionName: "earned", args: [evil.address] }),
        true,
      ]);
      await at(start + 600n, () => evil.write.execute([staking.address, claim]));

      assert.equal(await evil.read.reentrySucceeded(), true);
      const [seenEarned] = decodeAbiParameters([{ type: "uint256" }], await evil.read.reentryReturnData());
      assert.equal(seenEarned, 0n, "nothing is left to claim while the payout is in flight");
    });
  });

  describe("hostile owner and reward token", function () {
    it("fundRewards cannot be re-entered from the token's transferFrom", async function () {
      const stakingToken = await viem.deployContract("MockERC20", ["Stake Token", "STK", 18]);
      const evil = await viem.deployContract("ReentrantERC20");
      // The hostile token owns the pool, so its callback passes onlyOwner and reaches the guard.
      const staking = await viem.deployContract("LinearStaking", [stakingToken.address, evil.address, evil.address]);
      const fund = (amount: bigint) =>
        encodeFunctionData({ abi: staking.abi, functionName: "fundRewards", args: [amount, DAY] });

      await evil.write.mint([evil.address, 1_000n * ONE]);
      await evil.write.execute([
        evil.address,
        encodeFunctionData({ abi: evil.abi, functionName: "approve", args: [staking.address, maxUint256] }),
      ]);

      await evil.write.arm([staking.address, fund(1n * ONE), false]);
      await viem.assertions.revertWithCustomError(
        evil.write.execute([staking.address, fund(10n * ONE)]),
        staking,
        "ReentrancyGuardReentrantCall",
      );
      assert.equal(await staking.read.totalRewardsFunded(), 0n);

      // Without the callback the same call goes through, so the revert above was the guard.
      await evil.write.disarm();
      await evil.write.execute([staking.address, fund(10n * ONE)]);
      assert.equal(await staking.read.totalRewardsFunded(), 10n * ONE);
      assert.equal(getAddress(await staking.read.owner()), getAddress(evil.address));
    });
  });
});

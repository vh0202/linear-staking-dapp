import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAddress, maxUint256, zeroAddress } from "viem";

import { createTestEnv, DAY, HOUR, ONE, USER_FUNDS } from "../test-helpers/env.js";

describe("LinearStaking: pause and ownership", async function () {
  const env = await createTestEnv();
  const { viem, networkHelpers, owner, alice, bob, at, warpTo, timelineStart } = env;

  const load = () => networkHelpers.loadFixture(env.twoTokenPool);
  const addr = (wallet: typeof alice) => getAddress(wallet.account.address);

  describe("emergency pause", function () {
    it("only the owner can pause and unpause", async function () {
      const { staking } = await load();

      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.pause({ account: alice.account }),
        staking,
        "OwnableUnauthorizedAccount",
        [addr(alice)],
      );

      await viem.assertions.emitWithArgs(staking.write.pause(), staking, "Paused", [addr(owner)]);
      assert.equal(await staking.read.paused(), true);

      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.unpause({ account: alice.account }),
        staking,
        "OwnableUnauthorizedAccount",
        [addr(alice)],
      );

      await viem.assertions.emitWithArgs(staking.write.unpause(), staking, "Unpaused", [addr(owner)]);
      assert.equal(await staking.read.paused(), false);
    });

    it("pausing twice, or unpausing when not paused, reverts", async function () {
      const { staking } = await load();

      await viem.assertions.revertWithCustomError(staking.write.unpause(), staking, "ExpectedPause");
      await staking.write.pause();
      await viem.assertions.revertWithCustomError(staking.write.pause(), staking, "EnforcedPause");
    });

    it("blocks stake, claim and exit while paused", async function () {
      const { staking } = await load();
      await staking.write.stake([100n * ONE], { account: alice.account });
      await staking.write.pause();

      // Calls are created one at a time, so each is sent only after the previous one settled.
      for (const blocked of [
        () => staking.write.stake([ONE], { account: alice.account }),
        () => staking.write.claim({ account: alice.account }),
        () => staking.write.exit({ account: alice.account }),
      ]) {
        await viem.assertions.revertWithCustomError(blocked(), staking, "EnforcedPause");
      }

      // Everything works again after unpausing.
      await staking.write.unpause();
      await staking.write.stake([ONE], { account: alice.account });
      await staking.write.claim({ account: alice.account });
      await staking.write.exit({ account: alice.account });
    });

    it("still lets stakers withdraw their principal, in part or in full", async function () {
      const { staking, stakingToken } = await load();
      await staking.write.stake([100n * ONE], { account: alice.account });
      await staking.write.stake([40n * ONE], { account: bob.account });
      await staking.write.pause();

      await viem.assertions.emitWithArgs(
        staking.write.unstake([30n * ONE], { account: alice.account }),
        staking,
        "Unstaked",
        [addr(alice), 30n * ONE],
      );
      await staking.write.unstake([70n * ONE], { account: alice.account });
      await staking.write.unstake([40n * ONE], { account: bob.account });

      assert.equal(await stakingToken.read.balanceOf([addr(alice)]), USER_FUNDS);
      assert.equal(await stakingToken.read.balanceOf([addr(bob)]), USER_FUNDS);
      assert.equal(await staking.read.totalStaked(), 0n);
      assert.equal(await stakingToken.read.balanceOf([staking.address]), 0n);
    });

    it("keeps accruing while paused; rewards are claimable once unpaused", async function () {
      const { staking, rewardsToken } = await load();
      const start = await timelineStart();

      await staking.write.stake([100n * ONE], { account: alice.account });
      await staking.write.stake([100n * ONE], { account: bob.account });
      await at(start, () => staking.write.fundRewards([3_600n * ONE, HOUR])); // 0.5 token/s each

      await at(start + 600n, () => staking.write.pause());

      // Alice leaves during the pause and keeps what she earned up to that moment.
      await at(start + 1_200n, () => staking.write.unstake([100n * ONE], { account: alice.account }));
      assert.equal(await staking.read.earned([addr(alice)]), 600n * ONE);
      await viem.assertions.revertWithCustomError(
        staking.write.claim({ account: alice.account }),
        staking,
        "EnforcedPause",
      );

      // Bob stays; from 1,200 s on he is the only staker and earns the full rate.
      await at(start + 1_800n, () => staking.write.unpause());
      await at(start + 1_801n, () => staking.write.claim({ account: alice.account }));
      await at(start + HOUR, () => staking.write.claim({ account: bob.account }));

      assert.equal(await rewardsToken.read.balanceOf([addr(alice)]), 600n * ONE);
      assert.equal(await rewardsToken.read.balanceOf([addr(bob)]), 3_000n * ONE);
    });

    it("the owner can still fund a period while paused", async function () {
      const { staking } = await load();
      await staking.write.pause();

      await staking.write.fundRewards([1_000n * ONE, DAY]);

      assert.equal(await staking.read.totalRewardsFunded(), 1_000n * ONE);
    });
  });

  describe("two-step ownership", function () {
    it("transferOwnership only nominates; the nominee has to accept", async function () {
      const { staking, rewardsToken } = await load();

      await viem.assertions.emitWithArgs(
        staking.write.transferOwnership([addr(alice)]),
        staking,
        "OwnershipTransferStarted",
        [addr(owner), addr(alice)],
      );

      // Nothing has changed hands yet.
      assert.equal(getAddress(await staking.read.owner()), addr(owner));
      assert.equal(getAddress(await staking.read.pendingOwner()), addr(alice));
      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.pause({ account: alice.account }),
        staking,
        "OwnableUnauthorizedAccount",
        [addr(alice)],
      );
      await staking.write.fundRewards([100n * ONE, DAY]); // the current owner still can

      // Only the nominee can accept.
      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.acceptOwnership({ account: bob.account }),
        staking,
        "OwnableUnauthorizedAccount",
        [addr(bob)],
      );
      await viem.assertions.emitWithArgs(
        staking.write.acceptOwnership({ account: alice.account }),
        staking,
        "OwnershipTransferred",
        [addr(owner), addr(alice)],
      );

      assert.equal(getAddress(await staking.read.owner()), addr(alice));
      assert.equal(await staking.read.pendingOwner(), zeroAddress);

      // The previous owner has lost every privilege...
      for (const denied of [
        () => staking.write.pause(),
        () => staking.write.fundRewards([100n * ONE, DAY]),
        () => staking.write.transferOwnership([addr(owner)]),
      ]) {
        await viem.assertions.revertWithCustomErrorWithArgs(denied(), staking, "OwnableUnauthorizedAccount", [
          addr(owner),
        ]);
      }

      // ...and the new owner has them.
      await rewardsToken.write.mint([addr(alice), 100n * ONE]);
      await rewardsToken.write.approve([staking.address, maxUint256], { account: alice.account });
      await staking.write.fundRewards([100n * ONE, DAY], { account: alice.account });
      await staking.write.pause({ account: alice.account });
      assert.equal(await staking.read.paused(), true);
    });

    it("only the owner can nominate", async function () {
      const { staking } = await load();

      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.transferOwnership([addr(alice)], { account: alice.account }),
        staking,
        "OwnableUnauthorizedAccount",
        [addr(alice)],
      );
    });

    it("a nomination can be replaced or cancelled before it is accepted", async function () {
      const { staking } = await load();

      await staking.write.transferOwnership([addr(alice)]);
      await staking.write.transferOwnership([addr(bob)]);
      await viem.assertions.revertWithCustomError(
        staking.write.acceptOwnership({ account: alice.account }),
        staking,
        "OwnableUnauthorizedAccount",
      );

      await staking.write.transferOwnership([zeroAddress]);
      await viem.assertions.revertWithCustomError(
        staking.write.acceptOwnership({ account: bob.account }),
        staking,
        "OwnableUnauthorizedAccount",
      );
      assert.equal(getAddress(await staking.read.owner()), addr(owner));
    });

    it("ownership cannot be renounced by a stranger, nor while paused", async function () {
      const { staking } = await load();

      await viem.assertions.revertWithCustomErrorWithArgs(
        staking.write.renounceOwnership({ account: alice.account }),
        staking,
        "OwnableUnauthorizedAccount",
        [addr(alice)],
      );

      // An ownerless paused pool could never be unpaused again.
      await staking.write.pause();
      await viem.assertions.revertWithCustomError(staking.write.renounceOwnership(), staking, "EnforcedPause");
      assert.equal(getAddress(await staking.read.owner()), addr(owner));
    });

    it("after renouncing nobody can fund or pause, and stakers are unaffected", async function () {
      const { staking, stakingToken, rewardsToken } = await load();
      const start = await timelineStart();

      await staking.write.stake([100n * ONE], { account: alice.account });
      await at(start, () => staking.write.fundRewards([3_600n * ONE, HOUR]));

      await viem.assertions.emitWithArgs(staking.write.renounceOwnership(), staking, "OwnershipTransferred", [
        addr(owner),
        zeroAddress,
      ]);
      assert.equal(await staking.read.owner(), zeroAddress);

      for (const denied of [() => staking.write.pause(), () => staking.write.fundRewards([100n * ONE, DAY])]) {
        await viem.assertions.revertWithCustomErrorWithArgs(denied(), staking, "OwnableUnauthorizedAccount", [
          addr(owner),
        ]);
      }

      // The running period completes and pays out as scheduled.
      await warpTo(start + HOUR);
      await staking.write.exit({ account: alice.account });
      assert.equal(await rewardsToken.read.balanceOf([addr(alice)]), 3_600n * ONE);
      assert.equal(await stakingToken.read.balanceOf([addr(alice)]), USER_FUNDS);
    });
  });
});

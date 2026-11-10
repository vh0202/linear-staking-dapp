import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAddress } from "viem";

import { createTestEnv, DAY, MIN_REWARD_DURATION, RATE_PRECISION } from "../test-helpers/env.js";
import { assertPoolInvariants } from "../test-helpers/invariants.js";
import { MirroredPool } from "../test-helpers/mirror.js";
import { Random } from "../test-helpers/random.js";

/**
 * Property-style test: many random sequences of stake / unstake / claim / exit / fund /
 * pause / time jumps across four stakers. After EVERY step it asserts
 *
 *   I1  sum of all staked balances == totalStaked
 *   I2  total rewards paid <= total rewards funded (ledgers and observed token transfers)
 *   I3  the reward reserve covers accrued + still-to-be-emitted + unallocated rewards
 *   I4  the pool's token balance >= principal + unpaid rewards (also when both are one token)
 *   I5  every account's rewards match the exact reference model within the stated tolerance
 *   I6  the reward-per-token accumulator never decreases
 *   I7  unstake succeeds in every state, including while paused
 *
 * Reproduce a failure with the seed printed in the error:
 *   FUZZ_SEED=<seed> npx hardhat test test/LinearStaking.invariants.test.ts
 * FUZZ_RUNS and FUZZ_STEPS scale the number of sequences per pool type and steps per sequence.
 */
const SEED = Number(process.env.FUZZ_SEED ?? 20261110);
const SEQUENCES = Number(process.env.FUZZ_RUNS ?? 20);
const STEPS = Number(process.env.FUZZ_STEPS ?? 60);

type Action = "stake" | "unstake" | "claim" | "exit" | "fund" | "pause" | "wait";

const WEIGHTED_ACTIONS: readonly Action[] = [
  ...Array<Action>(6).fill("stake"),
  ...Array<Action>(4).fill("unstake"),
  ...Array<Action>(3).fill("claim"),
  ...Array<Action>(1).fill("exit"),
  ...Array<Action>(2).fill("fund"),
  ...Array<Action>(1).fill("pause"),
  ...Array<Action>(3).fill("wait"),
];

const FLAVOURS = [
  { name: "two tokens (18 / 18 decimals)", sameToken: false, rewardDecimals: 18 },
  { name: "same token for stake and rewards", sameToken: true, rewardDecimals: 18 },
  { name: "two tokens (18-decimal stake, 6-decimal rewards)", sameToken: false, rewardDecimals: 6 },
] as const;

describe("LinearStaking: invariants under random action sequences", async function () {
  const env = await createTestEnv();
  const { viem, stakers, at, warpTo, timelineStart } = env;
  const accounts = stakers.map((wallet) => getAddress(wallet.account.address));

  for (const [flavourIndex, flavour] of FLAVOURS.entries()) {
    it(`${flavour.name}: ${SEQUENCES} sequences x ${STEPS} random steps`, async function () {
      const random = new Random(SEED + flavourIndex);
      const counts: Record<Action | "blockedByPause", number> = {
        stake: 0,
        unstake: 0,
        claim: 0,
        exit: 0,
        fund: 0,
        pause: 0,
        wait: 0,
        blockedByPause: 0,
      };
      let maxDeviation = 0n;
      let maxDust = 0n;

      for (let sequence = 0; sequence < SEQUENCES; sequence++) {
        const pool = await env.deployPool(flavour);
        const { staking, stakingToken, rewardsToken } = pool;
        const mirror = new MirroredPool(env, pool);
        const maxReward = 50_000n * 10n ** BigInt(flavour.rewardDecimals);

        let time = await timelineStart();
        let paused = false;
        let settlements = 0;
        let lastAccumulator = 0n;
        let step = 0;
        let description = "setup";

        const expectPaused = async (call: Promise<unknown>) => {
          await viem.assertions.revertWithCustomError(call, staking, "EnforcedPause");
          counts.blockedByPause++;
        };

        try {
          for (step = 0; step < STEPS; step++) {
            // Jumps from one second to three days, so sequences cross period ends and idle gaps.
            time += random.magnitude(3n * DAY);
            const wallet = random.pick(stakers);
            const account = getAddress(wallet.account.address);
            const staked = mirror.reference.stakeOf(account);
            let action = random.pick(WEIGHTED_ACTIONS);
            // Keep pauses short, so most of a sequence exercises the unpaused paths.
            if (paused && random.chance(0.25)) action = "pause";

            // Fall back to a plain time jump when the action is impossible for this wallet.
            const walletBalance = await stakingToken.read.balanceOf([account]);
            if (action === "stake" && walletBalance === 0n) action = "wait";
            if ((action === "unstake" || action === "exit") && staked === 0n) action = "wait";
            counts[action]++;

            switch (action) {
              case "stake": {
                const amount = random.magnitude(walletBalance);
                description = `stake ${amount} by ${account}`;
                if (paused) await expectPaused(staking.write.stake([amount], { account: wallet.account }));
                else await mirror.stake(time, wallet, amount);
                break;
              }
              case "unstake": {
                // A third of the time the whole stake, otherwise a random part of it.
                const amount = random.chance(1 / 3) ? staked : random.bigint(1n, staked);
                description = `unstake ${amount} of ${staked} by ${account}`;
                await mirror.unstake(time, wallet, amount); // I7: never blocked, paused or not
                break;
              }
              case "claim": {
                description = `claim by ${account}`;
                if (paused) await expectPaused(staking.write.claim({ account: wallet.account }));
                else await mirror.claim(time, wallet);
                break;
              }
              case "exit": {
                description = `exit by ${account}`;
                if (paused) await expectPaused(staking.write.exit({ account: wallet.account }));
                else await mirror.exit(time, wallet);
                break;
              }
              case "fund": {
                const amount = random.magnitude(maxReward);
                const duration = random.bigint(MIN_REWARD_DURATION, 30n * DAY);
                description = `fund ${amount} over ${duration}s`;
                await mirror.fund(time, amount, duration);
                break;
              }
              case "pause": {
                description = paused ? "unpause" : "pause";
                await at(time, () => (paused ? staking.write.unpause() : staking.write.pause()));
                paused = !paused;
                break;
              }
              case "wait": {
                description = "wait";
                await warpTo(time);
                break;
              }
            }

            // I1-I4 on ledgers and real token balances.
            const state = await assertPoolInvariants(env, pool, accounts);
            // I2 against what was actually observed moving in and out of the pool.
            assert.equal(state.funded, mirror.totalFunded, "funded ledger == tokens pulled in");
            assert.equal(state.paid, mirror.totalPaid, "paid ledger == tokens received by stakers");
            assert.ok(mirror.totalPaid <= mirror.totalFunded, "I2: rewards paid <= rewards funded");
            // I5
            await mirror.assertMatchesReference(stakers);
            // I6
            const accumulator = await staking.read.rewardPerTokenStored();
            assert.ok(accumulator >= lastAccumulator, "I6: accumulator never decreases");
            lastAccumulator = accumulator;
          }

          // Wind down: let the period run out, then everybody leaves and collects.
          description = "wind down";
          time = (await staking.read.periodFinish()) > time ? (await staking.read.periodFinish()) + 1n : time + 1n;
          if (paused) await at(time++, () => staking.write.unpause());
          for (const wallet of stakers) {
            const account = getAddress(wallet.account.address);
            if (mirror.reference.stakeOf(account) > 0n) await mirror.exit(time++, wallet);
            else await mirror.claim(time++, wallet);
            settlements += mirror.settlementsOf(account);
          }
          await mirror.assertMatchesReference(stakers);
          const state = await assertPoolInvariants(env, pool, accounts);

          // Nothing is staked and nothing is claimable any more.
          assert.equal(state.totalStaked, 0n);
          assert.equal(state.accrued, 0n);
          // What is left of the funded rewards is exactly: rewards set aside for the next
          // period (emitted while nobody was staked) + rounding dust, and the dust is bounded
          // by one wei per settlement.
          const setAside = state.unallocated / RATE_PRECISION;
          const dust = state.reserve - setAside;
          assert.ok(dust >= 0n, "paid + set aside never exceeds funded");
          assert.ok(dust <= BigInt(settlements) + 1n, `dust ${dust} wei exceeds ${settlements} settlements`);
          // The pool holds exactly its ledgers: no principal is missing, no reward was created.
          const expectedHeld = flavour.sameToken ? state.reserve : 0n;
          assert.equal(await stakingToken.read.balanceOf([staking.address]), expectedHeld);
          assert.equal(await rewardsToken.read.balanceOf([staking.address]), state.reserve);

          if (dust > maxDust) maxDust = dust;
          if (mirror.maxDeviation > maxDeviation) maxDeviation = mirror.maxDeviation;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Invariant run failed (FUZZ_SEED=${SEED}, pool "${flavour.name}", sequence ${sequence}, ` +
              `step ${step}, action: ${description}): ${reason}`,
            { cause: error },
          );
        }
      }

      const steps = SEQUENCES * STEPS;
      console.log(
        `      seed ${SEED + flavourIndex}: ${steps} steps (${counts.stake} stake, ${counts.unstake} unstake, ` +
          `${counts.claim} claim, ${counts.exit} exit, ${counts.fund} fund, ${counts.pause} pause toggles, ` +
          `${counts.wait} waits; ${counts.blockedByPause} calls correctly blocked by pause). ` +
          `Largest gap to the exact model: ${maxDeviation} wei; largest dust left in a pool: ${maxDust} wei.`,
      );
      assert.ok(counts.stake > 0 && counts.unstake > 0 && counts.claim > 0 && counts.fund > 0);
    });
  }
});

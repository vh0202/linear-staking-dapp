import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Hash } from "viem";

import { createTestEnv, DAY, ONE } from "../test-helpers/env.js";

/**
 * Gas benchmark for the user-facing calls in a realistic steady state: a two-token pool
 * with a running reward period and another staker already in it. The numbers are the
 * `gasUsed` of real transactions on the in-memory chain (optimizer on, 200 runs).
 *
 * Each measurement also has a ceiling ~15% above the value measured when this file was
 * written, so an accidental gas regression fails the suite. Under `--coverage` the
 * contracts are instrumented and use more gas, so there the ceilings are not enforced.
 */
const INSTRUMENTED = process.env.HARDHAT_COVERAGE === "true";

describe("Gas benchmark (two-token pool, running reward period)", async function () {
  const env = await createTestEnv();
  const { publicClient, networkHelpers, alice, bob, carol, at, timelineStart } = env;

  it("measures stake, unstake, claim, exit and fundRewards", async function () {
    const { staking } = await networkHelpers.loadFixture(env.twoTokenPool);
    const start = await timelineStart();
    const rows: Array<{ call: string; scenario: string; gas: bigint; ceiling: bigint }> = [];

    const measure = async (call: string, scenario: string, ceiling: bigint, hash: Hash) => {
      const { gasUsed } = await publicClient.getTransactionReceipt({ hash });
      rows.push({ call, scenario, gas: gasUsed, ceiling });
    };

    await measure(
      "fundRewards",
      "first period (empty pool)",
      205_000n,
      await at(start, () => staking.write.fundRewards([70_000n * ONE, 7n * DAY])),
    );

    // Bob and Carol are in the pool before Alice arrives, so her calls run against live state.
    await at(start + 100n, () => staking.write.stake([500n * ONE], { account: bob.account }));
    await at(start + 200n, () => staking.write.stake([500n * ONE], { account: carol.account }));

    await measure(
      "stake",
      "first stake of an account",
      130_000n,
      await at(start + 1_000n, () => staking.write.stake([100n * ONE], { account: alice.account })),
    );
    await measure(
      "stake",
      "adding to an existing stake",
      114_000n,
      await at(start + 2_000n, () => staking.write.stake([100n * ONE], { account: alice.account })),
    );
    await measure(
      "claim",
      "first claim (new reward-token holder)",
      125_000n,
      await at(start + 3_000n, () => staking.write.claim({ account: alice.account })),
    );
    await measure(
      "claim",
      "later claim",
      89_000n,
      await at(start + 4_000n, () => staking.write.claim({ account: alice.account })),
    );
    await measure(
      "unstake",
      "partial",
      107_000n,
      await at(start + 5_000n, () => staking.write.unstake([50n * ONE], { account: alice.account })),
    );
    await measure(
      "unstake",
      "full",
      82_000n,
      await at(start + 6_000n, () => staking.write.unstake([150n * ONE], { account: alice.account })),
    );
    await measure(
      "exit",
      "full stake + first reward payout",
      150_000n,
      await at(start + 7_000n, () => staking.write.exit({ account: bob.account })),
    );
    await measure(
      "fundRewards",
      "top-up of a running period",
      96_000n,
      await at(start + 8_000n, () => staking.write.fundRewards([10_000n * ONE, 7n * DAY])),
    );

    console.log("\n      call          scenario                                 gas used");
    console.log("      ------------  ---------------------------------------  --------");
    for (const { call, scenario, gas } of rows) {
      console.log(`      ${call.padEnd(12)}  ${scenario.padEnd(39)}  ${gas.toString().padStart(8)}`);
    }
    if (INSTRUMENTED) {
      console.log("      (coverage instrumentation is on: numbers are inflated, ceilings are not enforced)\n");
      return;
    }
    console.log("");

    for (const { call, scenario, gas, ceiling } of rows) {
      assert.ok(gas <= ceiling, `${call} (${scenario}) used ${gas} gas, above its ceiling of ${ceiling}`);
    }
  });
});

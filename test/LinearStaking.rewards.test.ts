import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAddress } from "viem";

import { assertWithin, createTestEnv, DAY, HOUR, ONE, RATE_PRECISION } from "../test-helpers/env.js";
import { MirroredPool } from "../test-helpers/mirror.js";

describe("LinearStaking: reward accrual", async function () {
  const env = await createTestEnv();
  const { networkHelpers, alice, bob, carol, dave, eve, at, warpTo, timelineStart } = env;

  const load = () => networkHelpers.loadFixture(env.twoTokenPool);
  const addr = (wallet: typeof alice) => getAddress(wallet.account.address);

  describe("linear in time", function () {
    it("a lone staker has earned amount * elapsed / duration at every checkpoint", async function () {
      const { staking } = await load();
      const start = await timelineStart();
      const amount = 70_000n * ONE;
      const duration = 7n * DAY;

      await staking.write.stake([1_000n * ONE], { account: alice.account });
      await at(start, () => staking.write.fundRewards([amount, duration]));
      assert.equal(await staking.read.earned([addr(alice)]), 0n);

      const checkpoints = [
        1n,
        60n,
        HOUR,
        DAY,
        duration / 4n,
        duration / 2n,
        (duration * 3n) / 4n,
        duration - 1n,
        duration,
      ];
      for (const elapsed of checkpoints) {
        await warpTo(start + elapsed);
        const exact = (amount * elapsed) / duration; // independent calculation, rounded down
        const earned = await staking.read.earned([addr(alice)]);

        // Stated tolerance: the contract rounds down by at most 1 wei and never rounds up.
        assert.ok(earned <= exact, `earned ${earned} exceeds the exact amount ${exact} at +${elapsed}s`);
        assert.ok(exact - earned <= 1n, `earned ${earned} is more than 1 wei below ${exact} at +${elapsed}s`);
      }
    });

    it("equal time steps add equal rewards", async function () {
      const { staking } = await load();
      const start = await timelineStart();

      await staking.write.stake([250n * ONE], { account: alice.account });
      await at(start, () => staking.write.fundRewards([10_000n * ONE, 30n * DAY]));

      const step = 12_345n;
      const readings: bigint[] = [];
      for (let i = 0n; i <= 5n; i++) {
        await warpTo(start + 100n + i * step);
        readings.push(await staking.read.earned([addr(alice)]));
      }
      const increments = readings.slice(1).map((value, i) => value - readings[i]);
      const expected = (10_000n * ONE * step) / (30n * DAY);
      for (const increment of increments) assertWithin(increment, expected, 1n, "reward per step");
    });

    it("stops accruing at the end of the period", async function () {
      const { staking } = await load();
      const start = await timelineStart();
      const amount = 5_000n * ONE;
      const duration = 3n * DAY;

      await staking.write.stake([100n * ONE], { account: alice.account });
      await at(start, () => staking.write.fundRewards([amount, duration]));

      await warpTo(start + duration);
      const atEnd = await staking.read.earned([addr(alice)]);
      const accumulatorAtEnd = await staking.read.rewardPerToken();
      assert.ok(atEnd <= amount && amount - atEnd <= 1n, "the whole period's rewards have accrued");

      for (const after of [1n, HOUR, 30n * DAY]) {
        await warpTo(start + duration + after);
        assert.equal(await staking.read.earned([addr(alice)]), atEnd);
        assert.equal(await staking.read.rewardPerToken(), accumulatorAtEnd);
        assert.equal(await staking.read.lastTimeRewardApplicable(), start + duration);
      }
    });

    it("accrues from the moment of staking, not from the start of the period", async function () {
      const { staking } = await load();
      const start = await timelineStart();

      await at(start, () => staking.write.fundRewards([3_600n * ONE, HOUR])); // 1 token per second
      await at(start + 900n, () => staking.write.stake([100n * ONE], { account: alice.account }));
      assert.equal(await staking.read.earned([addr(alice)]), 0n);

      await warpTo(start + 1_500n);
      assert.equal(await staking.read.earned([addr(alice)]), 600n * ONE);
    });

    it("rewardPerToken follows elapsed * rate / totalStaked", async function () {
      const { staking } = await load();
      const start = await timelineStart();
      const staked = 333n * ONE;

      await staking.write.stake([staked], { account: alice.account });
      await at(start, () => staking.write.fundRewards([1_000n * ONE, 5n * DAY]));
      const rate = await staking.read.rewardRate();
      assert.equal(rate, (1_000n * ONE * RATE_PRECISION) / (5n * DAY));

      await warpTo(start + 4_321n);
      // rate carries 1e18, the accumulator carries 1e36.
      assert.equal(await staking.read.rewardPerToken(), (4_321n * rate * 10n ** 18n) / staked);
    });
  });

  describe("pro rata to stake", function () {
    it("splits rewards 25% / 75% between stakes of 100 and 300", async function () {
      const { staking } = await load();
      const start = await timelineStart();
      const amount = 8_000n * ONE;

      await staking.write.stake([100n * ONE], { account: alice.account });
      await staking.write.stake([300n * ONE], { account: bob.account });
      await at(start, () => staking.write.fundRewards([amount, DAY]));

      await warpTo(start + DAY / 2n);
      assertWithin(await staking.read.earned([addr(alice)]), 1_000n * ONE, 1n, "alice at half time");
      assertWithin(await staking.read.earned([addr(bob)]), 3_000n * ONE, 1n, "bob at half time");

      await warpTo(start + DAY);
      assertWithin(await staking.read.earned([addr(alice)]), 2_000n * ONE, 1n, "alice at the end");
      assertWithin(await staking.read.earned([addr(bob)]), 6_000n * ONE, 1n, "bob at the end");
    });

    it("weights by time: a staker who joins at half time with an equal stake gets a quarter", async function () {
      const { staking } = await load();
      const start = await timelineStart();

      await staking.write.stake([100n * ONE], { account: alice.account });
      await at(start, () => staking.write.fundRewards([3_600n * ONE, HOUR])); // 1 token per second
      await at(start + 1_800n, () => staking.write.stake([100n * ONE], { account: bob.account }));

      await warpTo(start + HOUR);
      // Alice: 1800 s alone + 1800 s at half share. Bob: 1800 s at half share.
      assert.equal(await staking.read.earned([addr(alice)]), 2_700n * ONE);
      assert.equal(await staking.read.earned([addr(bob)]), 900n * ONE);
    });

    it("matches the exact reference model while stakers join, top up, leave and claim", async function () {
      const pool = await load();
      const mirror = new MirroredPool(env, pool);
      const everyone = [alice, bob, carol, dave];
      const start = await timelineStart();
      const amount = 123_456_789n * 10n ** 15n; // 123,456.789 tokens: deliberately not round
      const duration = 250_000n;

      await mirror.stake(start - 50n, alice, 100n * ONE);
      await mirror.fund(start, amount, duration);
      await mirror.stake(start + 10_000n, bob, 300n * ONE);
      await mirror.assertMatchesReference(everyone);
      await mirror.stake(start + 40_000n, carol, 777n * 10n ** 17n);
      await mirror.unstake(start + 65_000n, alice, 40n * ONE);
      await mirror.assertMatchesReference(everyone);
      await mirror.claim(start + 90_000n, bob);
      await mirror.stake(start + 120_000n, dave, 1_000n * ONE);
      await warpTo(start + 135_000n);
      await mirror.assertMatchesReference(everyone);
      await mirror.exit(start + 150_000n, bob);
      await mirror.stake(start + 180_000n, alice, 500n * ONE);
      await mirror.unstake(start + 210_000n, carol, 777n * 10n ** 17n);
      await warpTo(start + duration);
      await mirror.assertMatchesReference(everyone);

      // After the period everybody collects; totals still match the model.
      let time = start + duration + 100n;
      for (const wallet of everyone) await mirror.claim(time++, wallet);
      await mirror.assertMatchesReference(everyone);

      // The pool was never empty during the period, so (almost) everything was paid out:
      // never more than funded, and short only by the rounding of the 11 settlements above.
      assert.ok(mirror.totalPaid <= amount);
      assert.ok(amount - mirror.totalPaid <= 11n, `unpaid dust is ${amount - mirror.totalPaid} wei`);
      assert.equal(await pool.staking.read.totalRewardsPaid(), mirror.totalPaid);
    });
  });

  describe("no compounding", function () {
    it("claiming early and often earns exactly as much as claiming once at the end", async function () {
      const { staking, rewardsToken } = await load();
      const start = await timelineStart();

      await staking.write.stake([100n * ONE], { account: alice.account });
      await staking.write.stake([100n * ONE], { account: bob.account });
      await at(start, () => staking.write.fundRewards([3_600n * ONE, HOUR])); // 0.5 token/s each

      // Alice claims every 10 minutes; Bob lets his rewards sit in the pool.
      for (let i = 1n; i <= 6n; i++) {
        await at(start + i * 600n, () => staking.write.claim({ account: alice.account }));
        assert.equal(await rewardsToken.read.balanceOf([addr(alice)]), i * 300n * ONE);
        // Bob's unclaimed rewards grow by the same fixed amount per step: they earn nothing.
        assert.equal(await staking.read.earned([addr(bob)]), i * 300n * ONE);
      }

      await at(start + HOUR + 60n, () => staking.write.claim({ account: bob.account }));
      assert.equal(await rewardsToken.read.balanceOf([addr(alice)]), 1_800n * ONE);
      assert.equal(await rewardsToken.read.balanceOf([addr(bob)]), 1_800n * ONE);
    });
  });

  describe("precision", function () {
    it("keeps full precision for a 6-decimal reward token against a large 18-decimal stake", async function () {
      const { staking } = await env.deployPool({ rewardDecimals: 6 });
      const start = await timelineStart();
      const amount = 1_000n * 10n ** 6n; // 1,000.000000 reward tokens
      const duration = 30n * DAY;

      await staking.write.stake([600_000n * ONE], { account: alice.account });
      await staking.write.stake([400_000n * ONE], { account: bob.account });
      await at(start, () => staking.write.fundRewards([amount, duration]));

      // Checkpoint the accumulator every minute for four hours. Eve has no stake, so her
      // claim() only triggers the update. With the common 1e18 accumulator scale every one
      // of these steps (60 s * ~385 units/s * 1e18 / 1e24 staked = 0.02) would truncate to
      // zero and the stakers would have earned nothing at all.
      const updates = 240n;
      for (let i = 1n; i <= updates; i++) {
        await at(start + i * 60n, () => staking.write.claim({ account: eve.account }));
      }

      const emitted = (amount * updates * 60n) / duration; // 5,555,555 units (5.56 tokens)
      assertWithin(await staking.read.earned([addr(alice)]), (emitted * 6n) / 10n, 1n, "alice (60%)");
      assertWithin(await staking.read.earned([addr(bob)]), (emitted * 4n) / 10n, 1n, "bob (40%)");
    });

    it("leaves only wei-level dust in the pool once everybody has left", async function () {
      const pool = await load();
      const { staking, rewardsToken, stakingToken } = pool;
      const mirror = new MirroredPool(env, pool);
      const start = await timelineStart();
      const amount = 1_000n * ONE + 7n;
      const duration = 3_601n;

      // Stakes of 1, 3 and 7 units give shares that are not exact in binary or decimal.
      await mirror.stake(start - 30n, alice, 1n * ONE);
      await mirror.stake(start - 20n, bob, 3n * ONE);
      await mirror.stake(start - 10n, carol, 7n * ONE);
      await mirror.fund(start, amount, duration);
      await mirror.claim(start + 1_111n, alice);
      await mirror.claim(start + 2_222n, bob);

      let time = start + duration + 1n;
      for (const wallet of [alice, bob, carol]) await mirror.exit(time++, wallet);
      await mirror.assertMatchesReference([alice, bob, carol]);

      const dust = amount - mirror.totalPaid;
      assert.ok(dust >= 0n, "never pays more than was funded");
      assert.ok(dust <= 8n, `dust is ${dust} wei (8 settlements, each rounds down by < 1 wei)`);

      // The dust is all that is left, it is accounted for, and nobody can claim it.
      assert.equal(await staking.read.totalStaked(), 0n);
      assert.equal(await stakingToken.read.balanceOf([staking.address]), 0n);
      assert.equal(await rewardsToken.read.balanceOf([staking.address]), dust);
      assert.equal(await staking.read.rewardReserve(), dust);
      for (const wallet of [alice, bob, carol]) {
        assert.equal(await staking.read.earned([addr(wallet)]), 0n);
      }
    });
  });

  describe("rewards emitted while nothing is staked", function () {
    it("are set aside instead of lost, and are added to the next period", async function () {
      const { staking, rewardsToken } = await load();
      const start = await timelineStart();

      await at(start, () => staking.write.fundRewards([3_600n * ONE, HOUR])); // 1 token per second
      await at(start + 900n, () => staking.write.stake([100n * ONE], { account: alice.account }));

      // The first 900 seconds had no staker.
      assert.equal(await staking.read.unallocatedRewards(), 900n * ONE * RATE_PRECISION);
      await warpTo(start + HOUR + 1n);
      assert.equal(await staking.read.earned([addr(alice)]), 2_700n * ONE);

      // Next period: 1,800 new tokens + the 900 set aside, over one hour = 0.75 token/s.
      const secondStart = start + 2n * HOUR;
      await at(secondStart, () => staking.write.fundRewards([1_800n * ONE, HOUR]));
      assert.equal(await staking.read.rewardRate(), (2_700n * ONE * RATE_PRECISION) / HOUR);
      assert.equal(await staking.read.unallocatedRewards(), 0n);

      await at(secondStart + HOUR + 1n, () => staking.write.claim({ account: alice.account }));

      // Every funded token reached a staker: 3,600 + 1,800.
      assert.equal(await rewardsToken.read.balanceOf([addr(alice)]), 5_400n * ONE);
      assert.equal(await staking.read.rewardReserve(), 0n);
    });

    it("a period that nobody joined is rolled over in full", async function () {
      const { staking } = await load();
      const start = await timelineStart();

      await at(start, () => staking.write.fundRewards([3_600n * ONE, HOUR]));
      // The first interaction after the period settles the unused emission.
      await at(start + 3n * HOUR, () => staking.write.stake([100n * ONE], { account: alice.account }));
      assert.equal(await staking.read.unallocatedRewards(), 3_600n * ONE * RATE_PRECISION);
      assert.equal(await staking.read.earned([addr(alice)]), 0n);

      await at(start + 4n * HOUR, () => staking.write.fundRewards([400n * ONE, 2n * HOUR]));
      assert.equal(await staking.read.rewardRate(), (4_000n * ONE * RATE_PRECISION) / (2n * HOUR));

      await warpTo(start + 6n * HOUR);
      assertWithin(await staking.read.earned([addr(alice)]), 4_000n * ONE, 1n, "alice");
    });
  });
});

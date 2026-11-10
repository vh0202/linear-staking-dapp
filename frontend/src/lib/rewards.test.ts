import { describe, expect, it } from "vitest";

import {
  accountRewardPerDay,
  accountRewardPerSecond,
  follow,
  FOLLOW_TIME_CONSTANT_MS,
  periodProgress,
  poolRewardPerDay,
  poolShareBps,
  projectEarned,
  RATE_PRECISION,
  rewardPerStakedTokenPerDay,
  secondsUntil,
  type RewardInputs,
} from "./rewards";

const ONE = 10n ** 18n;

/** 1 reward token per second for the whole pool; the account holds a quarter of it. */
const base: RewardInputs = {
  earned: 10n * ONE,
  staked: 250n * ONE,
  totalStaked: 1_000n * ONE,
  rewardRate: ONE * RATE_PRECISION,
  periodFinish: 2_000n,
  blockTimestamp: 1_000n,
};

describe("projectEarned", () => {
  it("returns the on-chain value when no time has passed", () => {
    expect(projectEarned(base, 0)).toBe(10n * ONE);
    expect(projectEarned(base, -500)).toBe(10n * ONE);
    expect(projectEarned(base, Number.NaN)).toBe(10n * ONE);
  });

  it("adds stake * rate * time / totalStaked", () => {
    // A quarter of 1 token/s.
    expect(projectEarned(base, 1_000)).toBe(10n * ONE + ONE / 4n);
    expect(projectEarned(base, 4_000)).toBe(11n * ONE);
    expect(projectEarned(base, 500)).toBe(10n * ONE + ONE / 8n);
  });

  it("stops at the end of the reward period", () => {
    const atEnd = 10n * ONE + 250n * ONE; // 1,000 s left at a quarter token per second
    expect(projectEarned(base, 1_000_000)).toBe(atEnd);
    expect(projectEarned(base, 5_000_000)).toBe(atEnd);
  });

  it("does not accrue after the period is over", () => {
    expect(projectEarned({ ...base, blockTimestamp: 2_000n }, 60_000)).toBe(10n * ONE);
    expect(projectEarned({ ...base, blockTimestamp: 9_999n }, 60_000)).toBe(10n * ONE);
  });

  it("does not accrue without a stake, an empty pool or a zero rate", () => {
    expect(projectEarned({ ...base, staked: 0n }, 60_000)).toBe(10n * ONE);
    expect(projectEarned({ ...base, totalStaked: 0n }, 60_000)).toBe(10n * ONE);
    expect(projectEarned({ ...base, rewardRate: 0n }, 60_000)).toBe(10n * ONE);
  });

  it("matches the contract formula for uneven numbers (rounded down)", () => {
    const inputs: RewardInputs = {
      earned: 123n,
      staked: 1_000n * ONE,
      totalStaked: 5_000n * ONE,
      rewardRate: (70_000n * ONE * RATE_PRECISION) / 604_800n, // 70,000 tokens over 7 days
      periodFinish: 604_800n,
      blockTimestamp: 0n,
    };
    const expected = 123n + (inputs.staked * inputs.rewardRate * 3_600n) / (inputs.totalStaked * RATE_PRECISION);
    expect(projectEarned(inputs, 3_600_000)).toBe(expected);
  });

  it("interpolates between two blocks: never backwards, and exact at the next block", () => {
    // Two seconds between blocks. What the page shows in between must rise steadily and
    // land on what the contract will report at the next block (nobody else moved).
    const atNextBlock = projectEarned(base, 2_000);
    expect(atNextBlock).toBe(10n * ONE + ONE / 2n);

    let previous = projectEarned(base, 0);
    for (let elapsedMs = 16; elapsedMs <= 2_000; elapsedMs += 16) {
      const value = projectEarned(base, elapsedMs);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(atNextBlock);
      previous = value;
    }

    // Projecting on from the next block's own snapshot continues the same line.
    const next: RewardInputs = { ...base, earned: atNextBlock, blockTimestamp: base.blockTimestamp + 2n };
    expect(projectEarned(next, 1_000)).toBe(projectEarned(base, 3_000));
  });
});

describe("poolRewardPerDay", () => {
  it("converts the scaled per-second rate to tokens per day", () => {
    expect(poolRewardPerDay(ONE * RATE_PRECISION)).toBe(86_400n * ONE);
    const sevenDayRate = (70_000n * ONE * RATE_PRECISION) / 604_800n;
    // 10,000 tokens per day, minus the truncation of the stored rate.
    expect(10_000n * ONE - poolRewardPerDay(sevenDayRate)).toBeLessThan(10n);
    expect(poolRewardPerDay(0n)).toBe(0n);
  });
});

describe("accountRewardPerDay", () => {
  it("is the account's share of the daily emission", () => {
    expect(accountRewardPerDay(250n * ONE, 1_000n * ONE, ONE * RATE_PRECISION)).toBe(21_600n * ONE);
    expect(accountRewardPerDay(1_000n * ONE, 1_000n * ONE, ONE * RATE_PRECISION)).toBe(86_400n * ONE);
  });

  it("is zero without a stake or with an empty pool", () => {
    expect(accountRewardPerDay(0n, 1_000n * ONE, ONE * RATE_PRECISION)).toBe(0n);
    expect(accountRewardPerDay(1n, 0n, ONE * RATE_PRECISION)).toBe(0n);
  });
});

describe("accountRewardPerSecond", () => {
  it("is the account's share of what the pool emits each second", () => {
    expect(accountRewardPerSecond(250n * ONE, 1_000n * ONE, ONE * RATE_PRECISION)).toBe(ONE / 4n);
    expect(accountRewardPerSecond(1_000n * ONE, 1_000n * ONE, ONE * RATE_PRECISION)).toBe(ONE);
  });

  it("agrees with the per-day figure", () => {
    const rate = (70_000n * ONE * RATE_PRECISION) / 604_800n;
    const perSecond = accountRewardPerSecond(1_000n * ONE, 5_000n * ONE, rate);
    const perDay = accountRewardPerDay(1_000n * ONE, 5_000n * ONE, rate);
    // Both round down, so a day of seconds falls short by less than one wei per second.
    expect(perDay - perSecond * 86_400n).toBeGreaterThanOrEqual(0n);
    expect(perDay - perSecond * 86_400n).toBeLessThan(86_400n);
  });

  it("is zero without a stake or with an empty pool", () => {
    expect(accountRewardPerSecond(0n, 1_000n * ONE, ONE * RATE_PRECISION)).toBe(0n);
    expect(accountRewardPerSecond(1n, 0n, ONE * RATE_PRECISION)).toBe(0n);
  });
});

describe("rewardPerStakedTokenPerDay", () => {
  it("divides the daily emission by the total stake: the local demo pays 2 RWD per STK per day", () => {
    const rate = (70_000n * ONE * RATE_PRECISION) / 604_800n; // 10,000 RWD per day
    const perToken = rewardPerStakedTokenPerDay(rate, 5_000n * ONE, 18);
    expect(2n * ONE - perToken).toBeGreaterThanOrEqual(0n);
    expect(2n * ONE - perToken).toBeLessThan(10n);
  });

  it("multiplied by the total stake, gives back the pool's daily emission", () => {
    const rate = 3n * ONE * RATE_PRECISION; // 3 reward tokens per second
    const total = 1_234n * ONE;
    const rebuilt = (rewardPerStakedTokenPerDay(rate, total, 18) * total) / ONE;
    expect(poolRewardPerDay(rate) - rebuilt).toBeGreaterThanOrEqual(0n);
    expect(poolRewardPerDay(rate) - rebuilt).toBeLessThan(2_000n);
  });

  it("uses the staking token's own decimals for one whole token", () => {
    // 1 reward token per second and 500 staked tokens with 6 decimals: 172.8 per token per day.
    expect(rewardPerStakedTokenPerDay(ONE * RATE_PRECISION, 500_000_000n, 6)).toBe((86_400n * ONE) / 500n);
  });

  it("is zero for an empty pool instead of dividing by zero", () => {
    expect(rewardPerStakedTokenPerDay(ONE * RATE_PRECISION, 0n, 18)).toBe(0n);
  });
});

describe("poolShareBps", () => {
  it("returns the share in basis points, rounded down", () => {
    expect(poolShareBps(1_000n * ONE, 5_000n * ONE)).toBe(2_000);
    expect(poolShareBps(1n, 3n)).toBe(3_333);
    expect(poolShareBps(5n, 5n)).toBe(10_000);
    expect(poolShareBps(0n, 5n)).toBe(0);
  });

  it("is zero for an empty pool", () => {
    expect(poolShareBps(0n, 0n)).toBe(0);
  });
});

describe("secondsUntil", () => {
  it("counts down to the end of the period and never goes negative", () => {
    expect(secondsUntil(2_000n, 1_500)).toBe(500);
    expect(secondsUntil(2_000n, 2_000)).toBe(0);
    expect(secondsUntil(2_000n, 9_000)).toBe(0);
    expect(secondsUntil(0n, 1_000)).toBe(0);
  });
});

describe("periodProgress", () => {
  const finish = 1_000_000n;
  const week = 604_800n;
  const start = Number(finish - week);

  it("reports a pool that was never funded", () => {
    expect(periodProgress(0n, undefined, 500)).toEqual({
      status: "none",
      secondsLeft: 0,
      start: undefined,
      elapsed: undefined,
    });
    expect(periodProgress(0n, week, 500).status).toBe("none");
  });

  it("derives the start and the elapsed share from the funded duration", () => {
    expect(periodProgress(finish, week, start)).toEqual({
      status: "active",
      secondsLeft: 604_800,
      start: finish - week,
      elapsed: 0,
    });
    expect(periodProgress(finish, week, start + 151_200)).toMatchObject({ secondsLeft: 453_600, elapsed: 0.25 });
    expect(periodProgress(finish, week, start + 302_400).elapsed).toBe(0.5);
    expect(periodProgress(finish, week, Number(finish) - 1)).toMatchObject({ status: "active", secondsLeft: 1 });
  });

  it("moves forward as time passes and never leaves 0..1", () => {
    let previous = 0;
    for (let offset = -1_000; offset <= 620_000; offset += 7_919) {
      const elapsed = periodProgress(finish, week, start + offset).elapsed ?? Number.NaN;
      expect(elapsed).toBeGreaterThanOrEqual(previous);
      expect(elapsed).toBeLessThanOrEqual(1);
      previous = elapsed;
    }
    expect(previous).toBe(1);
  });

  it("is complete at the end of the period and afterwards", () => {
    expect(periodProgress(finish, week, Number(finish))).toEqual({
      status: "ended",
      secondsLeft: 0,
      start: finish - week,
      elapsed: 1,
    });
    expect(periodProgress(finish, week, Number(finish) + 86_400)).toMatchObject({ status: "ended", elapsed: 1 });
    expect(periodProgress(finish, undefined, Number(finish) + 5)).toMatchObject({
      status: "ended",
      start: undefined,
      elapsed: 1,
    });
  });

  it("does not guess the progress while the duration is unknown", () => {
    expect(periodProgress(finish, undefined, Number(finish) - 3_600)).toEqual({
      status: "active",
      secondsLeft: 3_600,
      start: undefined,
      elapsed: undefined,
    });
    expect(periodProgress(finish, 0n, Number(finish) - 3_600).elapsed).toBeUndefined();
  });

  it("stays at zero before the start (a local clock that runs behind the chain)", () => {
    expect(periodProgress(finish, week, start - 500).elapsed).toBe(0);
  });
});

describe("follow", () => {
  const slack = ONE / 10n;

  it("stays where it is when it is on target", () => {
    expect(follow(5n * ONE, 5n * ONE, 16, slack)).toBe(5n * ONE);
  });

  it("eases towards a higher target without ever passing it, and arrives", () => {
    const target = 500n * ONE;
    let shown = 0n;
    for (let frame = 0; frame < 600; frame++) {
      const next = follow(shown, target, 16, slack);
      expect(next).toBeGreaterThanOrEqual(shown);
      expect(next).toBeLessThanOrEqual(target);
      shown = next;
    }
    expect(shown).toBe(target);
  });

  it("covers about 63% of the gap in one time constant, however the time is sliced", () => {
    const target = 1_000n * ONE;
    const inOneStep = follow(0n, target, FOLLOW_TIME_CONSTANT_MS, slack);
    let inManySteps = 0n;
    for (let step = 0; step < 18; step++) {
      inManySteps = follow(inManySteps, target, FOLLOW_TIME_CONSTANT_MS / 18, slack);
    }

    const expected = Number(target) * (1 - Math.exp(-1));
    expect(Math.abs(Number(inOneStep) - expected)).toBeLessThan(Number(target) / 100_000);
    expect(Math.abs(Number(inManySteps - inOneStep))).toBeLessThan(Number(target) / 10_000);
  });

  it("keeps up with a target that rises steadily, lagging by a bounded amount", () => {
    // A quarter token per second, 60 frames per second, for ten seconds.
    const perFrame = ONE / 240n;
    let target = 100n * ONE;
    let shown = target;
    for (let frame = 0; frame < 600; frame++) {
      target += perFrame;
      shown = follow(shown, target, 1000 / 60, slack);
      expect(shown).toBeLessThanOrEqual(target);
    }
    // The lag settles at about one time constant of accrual (0.18 s here: 0.045 tokens).
    expect(target - shown).toBeLessThan(ONE / 20n);
  });

  it("closes the last few wei in one step instead of creeping", () => {
    expect(follow(100n, 103n, 16, slack)).toBe(103n);
  });

  it("does not move without time passing", () => {
    expect(follow(0n, 10n * ONE, 0, slack)).toBe(0n);
    expect(follow(0n, 10n * ONE, -5, slack)).toBe(0n);
    expect(follow(0n, 10n * ONE, Number.NaN, slack)).toBe(0n);
  });

  it("holds instead of running backwards when the target is below by no more than the slack", () => {
    const shown = 10n * ONE;
    expect(follow(shown, shown - 1n, 16, slack)).toBe(shown);
    expect(follow(shown, shown - slack, 16, slack)).toBe(shown);
    expect(follow(shown, shown - slack, 0, slack)).toBe(shown);
  });

  it("drops at once when the target is below by more than the slack (a claim, an exit)", () => {
    const shown = 500n * ONE;
    expect(follow(shown, shown - slack - 1n, 16, slack)).toBe(shown - slack - 1n);
    expect(follow(shown, 0n, 16, slack)).toBe(0n);
    expect(follow(shown, 0n, 0, slack)).toBe(0n);
  });

  it("with no slack, any lower target is shown immediately", () => {
    expect(follow(10n, 9n, 16, 0n)).toBe(9n);
  });

  it("goes straight to the target for a very long step (reduced motion)", () => {
    expect(follow(0n, 123_456_789n * ONE, Number.MAX_SAFE_INTEGER, slack)).toBe(123_456_789n * ONE);
  });
});

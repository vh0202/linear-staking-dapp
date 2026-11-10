/** Scale of the contract's `rewardRate` (reward-token wei per second, times 1e18). */
export const RATE_PRECISION = 10n ** 18n;

const SECONDS_PER_DAY = 86_400n;

export type RewardInputs = {
  /** `earned(account)` at the snapshot block. */
  earned: bigint;
  /** The account's stake at the snapshot block. */
  staked: bigint;
  totalStaked: bigint;
  /** Contract `rewardRate`, scaled by RATE_PRECISION. */
  rewardRate: bigint;
  /** Unix seconds at which the reward period ends. */
  periodFinish: bigint;
  /** Timestamp of the snapshot block, unix seconds. */
  blockTimestamp: bigint;
};

/**
 * Estimates what `earned(account)` will be `elapsedMs` after the snapshot, so the UI can
 * tick between two reads of the chain. Same formula as the contract:
 *
 *   earned + stake * rate * dt / totalStaked,   with dt capped at the end of the period
 *
 * It is an estimate: it assumes nobody stakes or unstakes in the meantime. Every new
 * snapshot replaces it with the on-chain value.
 */
export function projectEarned(inputs: RewardInputs, elapsedMs: number): bigint {
  const { earned, staked, totalStaked, rewardRate, periodFinish, blockTimestamp } = inputs;
  if (staked === 0n || totalStaked === 0n || rewardRate === 0n) return earned;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return earned;

  const remainingMs = periodFinish > blockTimestamp ? (periodFinish - blockTimestamp) * 1000n : 0n;
  const requestedMs = BigInt(Math.floor(elapsedMs));
  const accruingMs = requestedMs < remainingMs ? requestedMs : remainingMs;

  return earned + (staked * rewardRate * accruingMs) / (totalStaked * RATE_PRECISION * 1000n);
}

/** Reward tokens the whole pool emits per day, in reward-token wei. */
export function poolRewardPerDay(rewardRate: bigint): bigint {
  return (rewardRate * SECONDS_PER_DAY) / RATE_PRECISION;
}

/** Reward tokens an account earns per day at its current share, in reward-token wei. */
export function accountRewardPerDay(staked: bigint, totalStaked: bigint, rewardRate: bigint): bigint {
  if (staked === 0n || totalStaked === 0n) return 0n;
  return (staked * rewardRate * SECONDS_PER_DAY) / (totalStaked * RATE_PRECISION);
}

/** Reward tokens an account earns per second at its current share, in reward-token wei. */
export function accountRewardPerSecond(staked: bigint, totalStaked: bigint, rewardRate: bigint): bigint {
  if (staked === 0n || totalStaked === 0n) return 0n;
  return (staked * rewardRate) / (totalStaked * RATE_PRECISION);
}

/**
 * Reward tokens one whole staked token earns per day, in reward-token wei:
 *
 *   rewardRate * 86,400 / totalStaked
 *
 * This is the only "rate of return" the page shows. It is not an APR: the two tokens have
 * no price, so there is nothing to express it as a percentage of.
 */
export function rewardPerStakedTokenPerDay(rewardRate: bigint, totalStaked: bigint, stakingDecimals: number): bigint {
  if (totalStaked === 0n) return 0n;
  return (rewardRate * SECONDS_PER_DAY * 10n ** BigInt(stakingDecimals)) / (totalStaked * RATE_PRECISION);
}

/** An account's share of the pool in basis points (10000 = 100%), rounded down. */
export function poolShareBps(staked: bigint, totalStaked: bigint): number {
  if (totalStaked === 0n) return 0;
  return Number((staked * 10_000n) / totalStaked);
}

/** Seconds until the reward period ends (0 when it is over). */
export function secondsUntil(periodFinish: bigint, nowSeconds: number): number {
  return Math.max(0, Number(periodFinish) - nowSeconds);
}

export type PeriodProgress = {
  /** "none": never funded. "active": rewards are being emitted. "ended": the period is over. */
  status: "none" | "active" | "ended";
  secondsLeft: number;
  /** Unix seconds at which the period started. Undefined when its duration is unknown. */
  start: bigint | undefined;
  /** Share of the period that has passed, 0..1. Undefined when its duration is unknown. */
  elapsed: number | undefined;
};

/**
 * Where the reward period stands at `nowSeconds`.
 *
 * `periodFinish` is read from the contract. The contract does not store when the period
 * started, so `duration` comes from the `RewardsFunded` event that set this `periodFinish`;
 * while that event has not been found the progress is unknown, not guessed.
 */
export function periodProgress(periodFinish: bigint, duration: bigint | undefined, nowSeconds: number): PeriodProgress {
  if (periodFinish === 0n) return { status: "none", secondsLeft: 0, start: undefined, elapsed: undefined };

  const known = duration !== undefined && duration > 0n;
  const start = known ? periodFinish - duration : undefined;
  const secondsLeft = secondsUntil(periodFinish, nowSeconds);
  if (secondsLeft === 0) return { status: "ended", secondsLeft: 0, start, elapsed: 1 };

  if (!known) return { status: "active", secondsLeft, start: undefined, elapsed: undefined };
  const elapsed = 1 - secondsLeft / Number(duration);
  return { status: "active", secondsLeft, start, elapsed: Math.min(1, Math.max(0, elapsed)) };
}

/** Time constant of the on-screen ticker's approach to its target, in milliseconds. */
export const FOLLOW_TIME_CONSTANT_MS = 180;

const FOLLOW_SCALE = 1_000_000n;

/**
 * One animation step of the number on screen (`shown`) towards the value derived from the
 * chain for this instant (`target`). This is how the ticker is reconciled with each block:
 *
 * - target above: ease towards it (exponential, never past it), so a correction glides
 *   instead of jumping and a long gap counts up;
 * - target below by at most `slack`: hold. Timing jitter between two reads must not make
 *   rewards appear to run backwards; the target catches up within a moment;
 * - target below by more than `slack`: the on-chain value really dropped (a claim, an
 *   exit): show it immediately, never more than the chain says.
 *
 * `dtMs` is the time since the previous step. With `dtMs` of 0 only the last two rules act.
 */
export function follow(shown: bigint, target: bigint, dtMs: number, slack: bigint): bigint {
  if (target === shown) return shown;
  if (target < shown) return shown - target <= slack ? shown : target;
  if (!Number.isFinite(dtMs) || dtMs <= 0) return shown;

  const gap = target - shown;
  const fraction = 1 - Math.exp(-dtMs / FOLLOW_TIME_CONSTANT_MS);
  const step = (gap * BigInt(Math.round(fraction * Number(FOLLOW_SCALE)))) / FOLLOW_SCALE;
  // Close the last few wei in one go instead of creeping towards them forever.
  return step === 0n ? target : shown + step;
}

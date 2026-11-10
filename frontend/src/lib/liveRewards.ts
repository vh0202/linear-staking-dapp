import type { Address } from "viem";

import { chainElapsedMs } from "./chainClock";
import { onFrame, prefersReducedMotion } from "./motion";
import { accountRewardPerSecond, follow, projectEarned, type RewardInputs } from "./rewards";
import { tweenValue } from "./tween";

/** What the ticker needs from a pool snapshot. */
export type LiveRewardInputs = RewardInputs & {
  account: Address;
  /** Estimated `chain clock - local clock` in ms, see chainClock.ts. */
  clockOffsetMs: number;
};

/** Clock jitter the ticker absorbs without running backwards: this many seconds of accrual. */
const SLACK_SECONDS = 2n;

/** A block that brings more than this many seconds of accrual at once is counted up to. */
const CATCH_UP_SECONDS = 10n;

/** How long that count takes, whatever the distance. */
export const CATCH_UP_MS = 700;

/** Under prefers-reduced-motion the number is refreshed at this pace instead of every frame. */
const REDUCED_MOTION_INTERVAL_MS = 1_000;

/**
 * The claimable rewards as they are shown on screen.
 *
 * Between two reads of the chain the value is interpolated from the reward rate
 * (`projectEarned`). Every new block replaces the inputs, and what is on screen is then
 * reconciled with the fresh on-chain value:
 *
 * - a small difference (the timing of the read) is absorbed by `follow`: gliding up,
 *   holding still rather than running backwards;
 * - a large step up (hours passed while the page was idle) is counted up to in a fixed time;
 * - less on chain than before (a claim, an exit) is shown at once.
 *
 * It lives outside React so that only the few elements that print the number re-render on
 * a frame.
 */
export function createLiveRewards() {
  let inputs: LiveRewardInputs | undefined;
  let shown = 0n;
  let lastStepMs: number | undefined;
  let catchUp: { from: bigint; startMs: number | undefined } | undefined;
  let stopFrames: (() => void) | undefined;
  const listeners = new Set<() => void>();

  const show = (value: bigint) => {
    if (value === shown) return;
    shown = value;
    for (const listener of [...listeners]) listener();
  };

  const targetAt = (current: LiveRewardInputs, nowMs: number) =>
    projectEarned(current, chainElapsedMs(current.blockTimestamp, current.clockOffsetMs, nowMs));

  const perSecond = (current: LiveRewardInputs) =>
    accountRewardPerSecond(current.staked, current.totalStaked, current.rewardRate);

  const step = (nowMs: number) => {
    if (inputs === undefined) return;
    const target = targetAt(inputs, nowMs);
    const slack = perSecond(inputs) * SLACK_SECONDS;

    if (prefersReducedMotion()) {
      if (lastStepMs !== undefined && nowMs - lastStepMs < REDUCED_MOTION_INTERVAL_MS) return;
      lastStepMs = nowMs;
      catchUp = undefined;
      // No easing and no counting: straight to the target (still never backwards on jitter).
      show(follow(shown, target, Number.MAX_SAFE_INTEGER, slack));
      return;
    }

    const dtMs = lastStepMs === undefined ? 0 : nowMs - lastStepMs;
    lastStepMs = nowMs;

    if (catchUp !== undefined) {
      catchUp.startMs ??= nowMs;
      const progress = (nowMs - catchUp.startMs) / CATCH_UP_MS;
      if (progress < 1 && target > shown) {
        const counted = tweenValue(catchUp.from, target, progress);
        show(counted > shown ? counted : shown);
        return;
      }
      catchUp = undefined;
      show(follow(shown, target, Number.MAX_SAFE_INTEGER, slack));
      return;
    }

    show(follow(shown, target, dtMs, slack));
  };

  return {
    /** The value to print, in reward-token wei. */
    get: () => shown,

    /** One animation step at local time `nowMs`. Called by the frame loop. */
    advance: step,

    subscribe(listener: () => void) {
      listeners.add(listener);
      stopFrames ??= onFrame(step);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopFrames?.();
          stopFrames = undefined;
          lastStepMs = undefined;
        }
      };
    },

    /** Called with every new snapshot of the connected account (undefined: no account). */
    setInputs(next: LiveRewardInputs | undefined, nowMs = Date.now()) {
      const previous = inputs;
      inputs = next;
      if (next === undefined) {
        catchUp = undefined;
        show(0n);
        return;
      }

      const target = targetAt(next, nowMs);
      // A first value, another account, or less on chain than before (claim, exit): nothing
      // to glide from, show the chain's value as it is.
      if (previous === undefined || previous.account !== next.account || next.earned < previous.earned) {
        catchUp = undefined;
        show(target);
        return;
      }

      if (target - shown > perSecond(next) * CATCH_UP_SECONDS) {
        // Far ahead of the screen: count up to it over the next frames.
        catchUp ??= { from: shown, startMs: undefined };
        return;
      }
      show(follow(shown, target, 0, perSecond(next) * SLACK_SECONDS));
    },
  };
}

export const liveRewards = createLiveRewards();

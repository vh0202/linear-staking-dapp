import { onFrame, prefersReducedMotion } from "./motion";

/** How long a number takes to count from its old value to its new one. */
export const TWEEN_MS = 450;

const SCALE = 1_000_000n;

/**
 * The value `progress` (0..1) of the way from `from` to `to`, on an ease-out curve. Exact at
 * both ends, and never outside the two values in between.
 */
export function tweenValue(from: bigint, to: bigint, progress: number): bigint {
  if (!(progress > 0)) return from;
  if (progress >= 1) return to;
  const eased = 1 - (1 - progress) ** 3;
  return from + ((to - from) * BigInt(Math.round(eased * Number(SCALE)))) / SCALE;
}

export type Tween = {
  /** The value to show right now. */
  get: () => bigint;
  subscribe: (listener: () => void) => () => void;
  /** Starts counting towards `value` from whatever is shown now. */
  to: (value: bigint) => void;
};

/**
 * A number that counts to each new value instead of jumping. Under prefers-reduced-motion
 * it jumps. Every tween runs on the shared frame loop and starts on a frame boundary, so
 * numbers that change in the same update also arrive in the same frame.
 */
export function createTween(initial: bigint): Tween {
  let shown = initial;
  let from = initial;
  let target = initial;
  let startMs: number | undefined;
  let stop: (() => void) | undefined;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of [...listeners]) listener();
  };

  const finish = () => {
    stop?.();
    stop = undefined;
    startMs = undefined;
    if (shown !== target) {
      shown = target;
      emit();
    }
  };

  const step = (nowMs: number) => {
    startMs ??= nowMs;
    const progress = (nowMs - startMs) / TWEEN_MS;
    if (progress >= 1) {
      finish();
      return;
    }
    const next = tweenValue(from, target, progress);
    if (next !== shown) {
      shown = next;
      emit();
    }
  };

  return {
    get: () => shown,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    to(value) {
      if (value === target) return;
      target = value;
      from = shown;
      startMs = undefined;
      if (prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
        finish();
        return;
      }
      stop ??= onFrame(step);
    },
  };
}

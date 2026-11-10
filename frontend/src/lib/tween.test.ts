import { describe, expect, it } from "vitest";

import { createTween, tweenValue } from "./tween";

const ONE = 10n ** 18n;

describe("tweenValue", () => {
  it("is exact at both ends", () => {
    expect(tweenValue(0n, 1_000n * ONE, 0)).toBe(0n);
    expect(tweenValue(0n, 1_000n * ONE, 1)).toBe(1_000n * ONE);
    expect(tweenValue(7n, 3n, 0)).toBe(7n);
    expect(tweenValue(7n, 3n, 1)).toBe(3n);
  });

  it("clamps progress outside 0..1", () => {
    expect(tweenValue(10n, 20n, -0.5)).toBe(10n);
    expect(tweenValue(10n, 20n, 1.5)).toBe(20n);
    expect(tweenValue(10n, 20n, Number.NaN)).toBe(10n);
  });

  it("moves fast first and slow last (ease-out)", () => {
    const half = tweenValue(0n, 1_000n, 0.5);
    expect(half).toBe(875n); // 1 - 0.5^3
    expect(tweenValue(0n, 1_000n, 0.9)).toBe(999n);
  });

  it("counts up without ever leaving the range or turning back", () => {
    const from = 4_000n * ONE;
    const to = 5_000n * ONE;
    let previous = from;
    for (let step = 0; step <= 100; step++) {
      const value = tweenValue(from, to, step / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(to);
      previous = value;
    }
    expect(previous).toBe(to);
  });

  it("counts down the same way", () => {
    const from = 10_000n * ONE;
    const to = 9_000n * ONE;
    let previous = from;
    for (let step = 0; step <= 100; step++) {
      const value = tweenValue(from, to, step / 100);
      expect(value).toBeLessThanOrEqual(previous);
      expect(value).toBeGreaterThanOrEqual(to);
      previous = value;
    }
    expect(previous).toBe(to);
  });

  it("stays put when there is nothing to count", () => {
    expect(tweenValue(42n, 42n, 0.3)).toBe(42n);
  });
});

describe("createTween", () => {
  it("shows the first value as it is", () => {
    expect(createTween(1_000n).get()).toBe(1_000n);
  });

  it("jumps to the new value where there are no animation frames (and under reduced motion)", () => {
    // This test runs in Node: no requestAnimationFrame, which takes the same path as
    // prefers-reduced-motion in a browser.
    const tween = createTween(1_000n);
    const seen: bigint[] = [];
    tween.subscribe(() => seen.push(tween.get()));

    tween.to(2_000n);
    expect(tween.get()).toBe(2_000n);
    expect(seen).toEqual([2_000n]);
  });

  it("does not notify for a value it already shows", () => {
    const tween = createTween(5n);
    let calls = 0;
    tween.subscribe(() => calls++);
    tween.to(5n);
    expect(calls).toBe(0);
  });

  it("stops notifying a listener that unsubscribed", () => {
    const tween = createTween(1n);
    let calls = 0;
    const unsubscribe = tween.subscribe(() => calls++);
    unsubscribe();
    tween.to(2n);
    expect(calls).toBe(0);
    expect(tween.get()).toBe(2n);
  });
});

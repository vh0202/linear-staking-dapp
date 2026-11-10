import { describe, expect, it } from "vitest";

import { chainElapsedMs, CLOCK_WINDOW, clockOffsetMs, observeBlock, type ClockObservation } from "./chainClock";

const NONE: readonly ClockObservation[] = [];

describe("observeBlock", () => {
  it("records the block's timestamp relative to when it was first seen", () => {
    expect(observeBlock(NONE, 10n, 1_000n, 999_400)).toEqual([{ blockNumber: 10n, offsetMs: 600 }]);
  });

  it("ignores a block that was already seen: only the first sighting counts", () => {
    const history = observeBlock(NONE, 10n, 1_000n, 999_400);
    expect(observeBlock(history, 10n, 1_000n, 1_005_000)).toBe(history);
  });

  it("keeps only the most recent blocks", () => {
    let history = NONE;
    for (let block = 1; block <= CLOCK_WINDOW + 3; block++) {
      history = observeBlock(history, BigInt(block), BigInt(1_000 + 2 * block), 0);
    }
    expect(history).toHaveLength(CLOCK_WINDOW);
    expect(history[0].blockNumber).toBe(4n);
    expect(history.at(-1)?.blockNumber).toBe(BigInt(CLOCK_WINDOW + 3));
  });

  it("starts over when the block number goes down (a local node was restarted)", () => {
    const history = observeBlock(observeBlock(NONE, 50n, 9_000n, 0), 51n, 9_002n, 0);
    expect(observeBlock(history, 3n, 100n, 99_000)).toEqual([{ blockNumber: 3n, offsetMs: 1_000 }]);
  });
});

describe("clockOffsetMs", () => {
  it("is zero before any block has been seen", () => {
    expect(clockOffsetMs(NONE)).toBe(0);
  });

  it("takes the block that was seen with the least delay", () => {
    // Same clocks, three blocks seen 900 ms, 150 ms and 600 ms after they were mined.
    let history = observeBlock(NONE, 1n, 1_000n, 1_000_900);
    history = observeBlock(history, 2n, 1_002n, 1_002_150);
    history = observeBlock(history, 3n, 1_004n, 1_004_600);
    expect(clockOffsetMs(history)).toBe(-150);
  });

  it("follows a chain whose clock jumps ahead (time travel on a test node)", () => {
    let history = observeBlock(NONE, 1n, 1_000n, 1_000_000);
    history = observeBlock(history, 2n, 1_002n + 21_600n, 1_002_000);
    expect(clockOffsetMs(history)).toBe(21_600_000);
  });

  it("forgets an offset once the blocks behind it leave the window", () => {
    // One block arrives implausibly early, the following ones are a second behind it.
    let history = observeBlock(NONE, 1n, 1_000n, 999_000);
    expect(clockOffsetMs(history)).toBe(1_000);
    for (let block = 2; block <= CLOCK_WINDOW + 1; block++) {
      history = observeBlock(history, BigInt(block), BigInt(1_000 + 2 * (block - 1)), 1_000_000 + 2_000 * (block - 1));
    }
    expect(clockOffsetMs(history)).toBe(0);
  });
});

describe("chainElapsedMs", () => {
  it("is the chain time that has passed since the block", () => {
    // Block at 1,000 s; chain clock 600 ms ahead of the local one.
    expect(chainElapsedMs(1_000n, 600, 999_400)).toBe(0);
    expect(chainElapsedMs(1_000n, 600, 1_000_650)).toBe(1_250);
  });

  it("is never negative", () => {
    expect(chainElapsedMs(1_000n, 0, 990_000)).toBe(0);
  });

  it("is continuous from one block to the next: the page's time does not restart", () => {
    // With a steady offset, "block 1 + elapsed" and "block 2 + elapsed" are the same instant.
    const offset = clockOffsetMs(observeBlock(observeBlock(NONE, 1n, 1_000n, 1_000_100), 2n, 1_002n, 1_002_100));
    const now = 1_002_700;
    const sinceFirst = 1_000_000 + chainElapsedMs(1_000n, offset, now);
    const sinceSecond = 1_002_000 + chainElapsedMs(1_002n, offset, now);
    expect(sinceFirst).toBe(sinceSecond);
  });
});

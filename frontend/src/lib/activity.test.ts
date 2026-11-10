import type { Hash } from "viem";
import { describe, expect, it } from "vitest";

import { ACTIVITY_LIMIT, latestActivity, type ActivityEntry } from "./activity";
import { eventsFromBlock } from "./pool";

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;

const entry = (kind: ActivityEntry["kind"], blockNumber: number, logIndex: number, tx = blockNumber): ActivityEntry => ({
  kind,
  amount: BigInt(blockNumber) * 10n ** 18n,
  transactionHash: hash(tx),
  blockNumber: BigInt(blockNumber),
  blockHash: hash(1_000 + blockNumber),
  logIndex,
});

describe("latestActivity", () => {
  it("lists the newest block first", () => {
    const sorted = latestActivity([entry("staked", 12, 0), entry("claimed", 30, 0), entry("unstaked", 21, 0)]);
    expect(sorted.map(({ blockNumber }) => blockNumber)).toEqual([30n, 21n, 12n]);
  });

  it("orders the events of one block by their position in it, last first", () => {
    // exit(): Unstaked and RewardPaid in the same transaction.
    const exit = [entry("unstaked", 40, 3, 7), entry("claimed", 40, 5, 7), entry("staked", 40, 1, 6)];
    expect(latestActivity(exit).map(({ kind }) => kind)).toEqual(["claimed", "unstaked", "staked"]);
  });

  it("keeps one entry per log, however often it was read", () => {
    const once = entry("staked", 12, 0);
    expect(latestActivity([once, { ...once }, entry("claimed", 13, 0), once])).toHaveLength(2);
  });

  it("keeps two logs of the same transaction apart", () => {
    expect(latestActivity([entry("unstaked", 40, 3, 7), entry("claimed", 40, 5, 7)])).toHaveLength(2);
  });

  it("shows only the newest few", () => {
    const many = Array.from({ length: 20 }, (_, index) => entry("staked", index + 1, 0));
    const shown = latestActivity(many);
    expect(shown).toHaveLength(ACTIVITY_LIMIT);
    expect(shown[0].blockNumber).toBe(20n);
    expect(latestActivity(many, 2).map(({ blockNumber }) => blockNumber)).toEqual([20n, 19n]);
  });

  it("returns an empty list for an account without events, and does not change its input", () => {
    expect(latestActivity([])).toEqual([]);
    const input = [entry("staked", 1, 0), entry("staked", 2, 0)];
    latestActivity(input);
    expect(input.map(({ blockNumber }) => blockNumber)).toEqual([1n, 2n]);
  });
});

describe("eventsFromBlock", () => {
  it("reads the whole chain when there is no limit (the local node)", () => {
    expect(eventsFromBlock(123n, undefined)).toBe(0n);
  });

  it("reaches back at most `lookback` blocks", () => {
    expect(eventsFromBlock(9_000_000n, 50_000n)).toBe(8_950_000n);
  });

  it("starts at the first block on a chain shorter than the limit", () => {
    expect(eventsFromBlock(120n, 50_000n)).toBe(0n);
    expect(eventsFromBlock(50_000n, 50_000n)).toBe(0n);
  });
});

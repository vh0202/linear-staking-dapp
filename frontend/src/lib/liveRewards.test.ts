import { describe, expect, it } from "vitest";

import { CATCH_UP_MS, createLiveRewards, type LiveRewardInputs } from "./liveRewards";
import { RATE_PRECISION } from "./rewards";

const ONE = 10n ** 18n;
const ALICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BOB = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

/**
 * 1 reward token per second for the pool, a quarter of it for the account. The block was
 * mined at chain time 1,000 s and the two clocks agree, so local time 1,000,000 ms is the
 * block's own instant.
 */
const block: LiveRewardInputs = {
  account: ALICE,
  earned: 10n * ONE,
  staked: 250n * ONE,
  totalStaked: 1_000n * ONE,
  rewardRate: ONE * RATE_PRECISION,
  periodFinish: 5_000n,
  blockTimestamp: 1_000n,
  clockOffsetMs: 0,
};
const at = (secondsAfterBlock: number) => 1_000_000 + secondsAfterBlock * 1_000;

describe("live rewards: reconciling the ticker with each new block", () => {
  it("shows nothing without an account", () => {
    const live = createLiveRewards();
    expect(live.get()).toBe(0n);
    live.setInputs(undefined);
    expect(live.get()).toBe(0n);
  });

  it("starts at the value derived from the chain for this instant, without counting up", () => {
    const live = createLiveRewards();
    live.setInputs(block, at(0));
    expect(live.get()).toBe(10n * ONE);

    const later = createLiveRewards();
    later.setInputs(block, at(2));
    expect(later.get()).toBe(10n * ONE + ONE / 2n);
  });

  it("is unchanged by a new block that confirms the projection", () => {
    const live = createLiveRewards();
    live.setInputs(block, at(2));
    const shown = live.get();

    // Two seconds later the chain reports exactly what was projected.
    live.setInputs({ ...block, earned: 10n * ONE + ONE / 2n, blockTimestamp: 1_002n }, at(2));
    expect(live.get()).toBe(shown);
  });

  it("does not run backwards when a block arrives slightly behind the projection", () => {
    const live = createLiveRewards();
    live.setInputs(block, at(2));
    const shown = live.get();

    // The new block was mined 0.4 s earlier than the page assumed: the target is 0.1 lower.
    live.setInputs({ ...block, earned: 10n * ONE + (ONE * 4n) / 10n, blockTimestamp: 1_002n, clockOffsetMs: -400 }, at(2.4));
    expect(live.get()).toBe(shown);
  });

  it("drops at once after a claim, even a small one", () => {
    const live = createLiveRewards();
    live.setInputs(block, at(1));
    expect(live.get()).toBe(10n * ONE + ONE / 4n);

    live.setInputs({ ...block, earned: 0n, blockTimestamp: 1_001n }, at(1));
    expect(live.get()).toBe(0n);

    // An amount smaller than the jitter the ticker tolerates is still shown as claimed, not held.
    const small = createLiveRewards();
    small.setInputs({ ...block, earned: (ONE * 3n) / 10n }, at(0));
    expect(small.get()).toBe((ONE * 3n) / 10n);
    small.setInputs({ ...block, earned: 0n, blockTimestamp: 1_001n }, at(1));
    expect(small.get()).toBe(0n);
  });

  it("counts up to a target that jumped far ahead, in a fixed time, and arrives exactly", () => {
    const live = createLiveRewards();
    live.setInputs({ ...block, periodFinish: 1_000n }, at(0));
    expect(live.get()).toBe(10n * ONE);

    // Six hours of rewards arrive with one block (the period has ended, so the target is fixed).
    live.setInputs({ ...block, earned: 510n * ONE, blockTimestamp: 22_600n, periodFinish: 1_000n }, at(0));
    expect(live.get()).toBe(10n * ONE);

    let previous = live.get();
    const frames = Math.ceil(CATCH_UP_MS / 16) + 1;
    for (let frame = 0; frame <= frames; frame++) {
      live.advance(at(0) + frame * 16);
      expect(live.get()).toBeGreaterThanOrEqual(previous);
      expect(live.get()).toBeLessThanOrEqual(510n * ONE);
      previous = live.get();
      if (frame === Math.floor(frames / 2)) expect(live.get()).toBeGreaterThan(400n * ONE); // ease-out: most of the way early
    }
    expect(live.get()).toBe(510n * ONE);
  });

  it("counts up to a moving target too, then goes on ticking", () => {
    const running = { ...block, periodFinish: 100_000n };
    const live = createLiveRewards();
    live.setInputs(running, at(0));
    // Six hours later (chain time), the period still running: 5,400 more tokens.
    live.setInputs({ ...running, earned: 5_410n * ONE, blockTimestamp: 22_600n, clockOffsetMs: 21_600_000 }, at(0));

    let previous = live.get();
    for (let frame = 0; frame <= 120; frame++) {
      live.advance(at(0) + frame * 16);
      expect(live.get()).toBeGreaterThanOrEqual(previous);
      previous = live.get();
    }
    // 1.92 s after the block: 0.48 more tokens, less the ticker's small lag.
    const target = 5_410n * ONE + (ONE * 48n) / 100n;
    expect(live.get()).toBeLessThanOrEqual(target);
    expect(target - live.get()).toBeLessThan(ONE / 20n);
  });

  it("ticks between two blocks at the account's rate", () => {
    const live = createLiveRewards();
    live.setInputs(block, at(0));
    for (let frame = 0; frame <= 125; frame++) live.advance(at(0) + frame * 16);

    // Two seconds in: a quarter token per second, less the ticker's small lag.
    const target = 10n * ONE + ONE / 2n;
    expect(live.get()).toBeLessThanOrEqual(target);
    expect(target - live.get()).toBeLessThan(ONE / 20n);
  });

  it("drops at once when somebody else's stake lowers the projection by more than the slack", () => {
    const live = createLiveRewards();
    live.setInputs(block, at(100));
    expect(live.get()).toBe(35n * ONE);

    // On chain only 20 tokens had accrued by then (the pool grew meanwhile).
    live.setInputs({ ...block, earned: 20n * ONE, totalStaked: 2_000n * ONE, blockTimestamp: 1_100n }, at(100));
    expect(live.get()).toBe(20n * ONE);
  });

  it("starts afresh for another account", () => {
    const live = createLiveRewards();
    live.setInputs(block, at(1));
    live.setInputs({ ...block, account: BOB, earned: 3n * ONE }, at(1));
    expect(live.get()).toBe(3n * ONE + ONE / 4n);
  });

  it("returns to zero when the wallet disconnects", () => {
    const live = createLiveRewards();
    live.setInputs(block, at(1));
    live.setInputs(undefined);
    expect(live.get()).toBe(0n);
  });

  it("stops at the end of the reward period", () => {
    const live = createLiveRewards();
    live.setInputs({ ...block, periodFinish: 1_010n }, at(3_600));
    expect(live.get()).toBe(10n * ONE + (10n * ONE) / 4n);
  });
});

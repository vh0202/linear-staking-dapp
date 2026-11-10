import assert from "node:assert/strict";

import { network } from "hardhat";
import { maxUint256, type Address, type Hash } from "viem";

export const ONE = 10n ** 18n;
export const HOUR = 3_600n;
export const DAY = 86_400n;

// Mirrors of the contract constants, written out independently on purpose.
export const RATE_PRECISION = 10n ** 18n;
export const ACC_PRECISION = 10n ** 36n;
export const MIN_REWARD_DURATION = HOUR;
export const MAX_REWARD_DURATION = 5n * 365n * DAY;
export const MAX_TOTAL_REWARDS = 2n ** 128n - 1n;

/** What every staker starts with, and what the owner holds to fund rewards. */
export const USER_FUNDS = 1_000_000n * ONE;
export const OWNER_FUNDS = 10_000_000n * ONE;

export function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** Asserts |actual - expected| <= tolerance. */
export function assertWithin(actual: bigint, expected: bigint, tolerance: bigint, label = "value"): void {
  const diff = abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${label}: expected ${expected} within ${tolerance}, got ${actual} (off by ${diff})`,
  );
}

/**
 * One isolated in-memory chain plus the accounts, fixtures and time helpers shared by the
 * test files. Each test file creates its own environment, so files cannot affect each other.
 */
export async function createTestEnv() {
  const { viem, networkHelpers, ignition } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [owner, alice, bob, carol, dave, eve] = await viem.getWalletClients();
  const stakers = [alice, bob, carol, dave];

  /** Timestamp of the latest block. */
  async function latest(): Promise<bigint> {
    return BigInt(await networkHelpers.time.latest());
  }

  /** Sends a transaction that is mined in a block stamped exactly `timestamp`. */
  async function at(timestamp: bigint, send: () => Promise<Hash>): Promise<Hash> {
    await networkHelpers.time.setNextBlockTimestamp(timestamp);
    return send();
  }

  /** Mines an empty block stamped `timestamp`, so views are evaluated at exactly that time. */
  async function warpTo(timestamp: bigint): Promise<void> {
    await networkHelpers.time.increaseTo(timestamp);
  }

  /** A timestamp safely ahead of the chain clock, used as the origin of a test's timeline. */
  async function timelineStart(): Promise<bigint> {
    return (await latest()) + 1_000n;
  }

  async function deployTokens(sameToken: boolean, stakingDecimals: number, rewardDecimals: number) {
    const stakingToken = await viem.deployContract("MockERC20", ["Stake Token", "STK", stakingDecimals]);
    const rewardsToken = sameToken
      ? stakingToken
      : await viem.deployContract("MockERC20", ["Reward Token", "RWD", rewardDecimals]);
    return { stakingToken, rewardsToken };
  }

  /** Mints test balances and gives the pool unlimited allowances. */
  async function seed(
    pool: Address,
    stakingToken: Awaited<ReturnType<typeof deployTokens>>["stakingToken"],
    rewardsToken: Awaited<ReturnType<typeof deployTokens>>["rewardsToken"],
  ) {
    for (const staker of stakers) {
      await stakingToken.write.mint([staker.account.address, USER_FUNDS]);
      await stakingToken.write.approve([pool, maxUint256], { account: staker.account });
    }
    await rewardsToken.write.mint([owner.account.address, OWNER_FUNDS]);
    await rewardsToken.write.approve([pool, maxUint256], { account: owner.account });
  }

  async function deployPool(options: { sameToken?: boolean; stakingDecimals?: number; rewardDecimals?: number } = {}) {
    const { sameToken = false, stakingDecimals = 18, rewardDecimals = 18 } = options;
    const { stakingToken, rewardsToken } = await deployTokens(sameToken, stakingDecimals, rewardDecimals);
    const staking = await viem.deployContract("LinearStaking", [
      stakingToken.address,
      rewardsToken.address,
      owner.account.address,
    ]);
    await seed(staking.address, stakingToken, rewardsToken);
    return { staking, stakingToken, rewardsToken };
  }

  // Named fixtures (loadFixture caches by function identity).

  /** Staking token and reward token are two different 18-decimal tokens. */
  async function twoTokenPool() {
    return deployPool();
  }

  /** Staking token and reward token are the same token. */
  async function sameTokenPool() {
    return deployPool({ sameToken: true });
  }

  /** Same-token pool built on the test harness that can corrupt the reward ledger. */
  async function sameTokenHarnessPool() {
    const { stakingToken, rewardsToken } = await deployTokens(true, 18, 18);
    const staking = await viem.deployContract("LinearStakingHarness", [
      stakingToken.address,
      rewardsToken.address,
      owner.account.address,
    ]);
    await seed(staking.address, stakingToken, rewardsToken);
    return { staking, stakingToken, rewardsToken };
  }

  return {
    viem,
    networkHelpers,
    ignition,
    publicClient,
    owner,
    alice,
    bob,
    carol,
    dave,
    eve,
    stakers,
    latest,
    at,
    warpTo,
    timelineStart,
    deployPool,
    twoTokenPool,
    sameTokenPool,
    sameTokenHarnessPool,
  };
}

export type TestEnv = Awaited<ReturnType<typeof createTestEnv>>;

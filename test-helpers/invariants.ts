import assert from "node:assert/strict";

import type { Address } from "viem";

import { RATE_PRECISION, type TestEnv } from "./env.js";

type Pool = Awaited<ReturnType<TestEnv["deployPool"]>>;

/**
 * Asserts the pool's accounting invariants at the latest block.
 *
 * `accounts` must contain every account that has ever staked in this pool.
 *
 *   I1  sum of all staked balances == totalStaked
 *   I2  totalRewardsPaid <= totalRewardsFunded, and rewardReserve is their difference
 *   I3  the reward reserve covers every reward that is promised: rewards already accrued
 *       to accounts + everything the current rate will still emit + unallocated rewards
 *   I4  the tokens actually held cover principal + reward reserve (in the same-token case
 *       both are claims on one balance, so the reserve can never eat into principal)
 */
export async function assertPoolInvariants(env: TestEnv, pool: Pool, accounts: Address[]) {
  const { staking, stakingToken, rewardsToken } = pool;
  const sameToken = stakingToken.address === rewardsToken.address;
  const now = await env.latest();

  const [totalStaked, funded, paid, reserve, rate, periodFinish, unallocated, heldStaking, heldRewards] =
    await Promise.all([
      staking.read.totalStaked(),
      staking.read.totalRewardsFunded(),
      staking.read.totalRewardsPaid(),
      staking.read.rewardReserve(),
      staking.read.rewardRate(),
      staking.read.periodFinish(),
      staking.read.unallocatedRewards(),
      stakingToken.read.balanceOf([staking.address]),
      rewardsToken.read.balanceOf([staking.address]),
    ]);

  let sumOfStakes = 0n;
  let accrued = 0n;
  for (const account of accounts) {
    sumOfStakes += await staking.read.stakedBalance([account]);
    accrued += await staking.read.earned([account]);
  }

  // I1
  assert.equal(sumOfStakes, totalStaked, "I1: sum of stakes == totalStaked");

  // I2
  assert.ok(paid <= funded, "I2: rewards paid <= rewards funded");
  assert.equal(reserve, funded - paid, "I2: rewardReserve == funded - paid");

  // I3 (compared at RATE_PRECISION so nothing is rounded away)
  const remainingSeconds = periodFinish > now ? periodFinish - now : 0n;
  const promised = accrued * RATE_PRECISION + remainingSeconds * rate + unallocated;
  assert.ok(
    promised <= reserve * RATE_PRECISION,
    `I3: promised rewards ${promised} exceed the reserve ${reserve * RATE_PRECISION} (1e18-scaled)`,
  );

  // I4
  if (sameToken) {
    assert.ok(heldStaking >= totalStaked + reserve, "I4: balance >= principal + reward reserve");
    assert.ok(heldStaking - totalStaked >= accrued, "I4: balance >= principal + unpaid rewards");
  } else {
    assert.ok(heldStaking >= totalStaked, "I4: staking-token balance >= principal");
    assert.ok(heldRewards >= reserve, "I4: reward-token balance >= reward reserve");
    assert.ok(heldRewards >= accrued, "I4: reward-token balance >= unpaid rewards");
  }

  return { totalStaked, funded, paid, reserve, rate, periodFinish, unallocated, heldStaking, heldRewards, accrued };
}

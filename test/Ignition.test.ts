import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAddress } from "viem";

import LinearStakingModule from "../ignition/modules/LinearStaking.js";
import TestnetDemoModule from "../ignition/modules/TestnetDemo.js";
import { createTestEnv, DAY, ONE, RATE_PRECISION } from "../test-helpers/env.js";

/**
 * The Ignition modules are what the (not executed) Sepolia steps run. Deploying them on the
 * in-memory chain checks the modules themselves: constructor wiring, parameters, call order.
 */
describe("Ignition deployment modules", async function () {
  const env = await createTestEnv();
  const { viem, ignition, owner, alice } = env;

  it("LinearStaking module wires the tokens and the owner from parameters", async function () {
    const stakingToken = await viem.deployContract("MockERC20", ["Stake Token", "STK", 18]);
    const rewardsToken = await viem.deployContract("MockERC20", ["Reward Token", "RWD", 6]);

    const { staking } = await ignition.deploy(LinearStakingModule, {
      parameters: {
        LinearStaking: {
          stakingToken: stakingToken.address,
          rewardsToken: rewardsToken.address,
          owner: alice.account.address,
        },
      },
    });

    assert.equal(getAddress(await staking.read.stakingToken()), getAddress(stakingToken.address));
    assert.equal(getAddress(await staking.read.rewardsToken()), getAddress(rewardsToken.address));
    assert.equal(getAddress(await staking.read.owner()), getAddress(alice.account.address));
  });

  it("LinearStaking module defaults the owner to the deployer", async function () {
    const token = await viem.deployContract("MockERC20", ["Stake Token", "STK", 18]);

    const { staking } = await ignition.deploy(LinearStakingModule, {
      parameters: { LinearStaking: { stakingToken: token.address, rewardsToken: token.address } },
    });

    assert.equal(getAddress(await staking.read.owner()), getAddress(owner.account.address));
  });

  it("TestnetDemo module deploys both tokens and the pool, and funds the first period", async function () {
    const { staking, stakingToken, rewardsToken } = await ignition.deploy(TestnetDemoModule);

    assert.equal(await stakingToken.read.symbol(), "dSTK");
    assert.equal(await rewardsToken.read.symbol(), "dRWD");
    assert.equal(getAddress(await staking.read.stakingToken()), getAddress(stakingToken.address));
    assert.equal(getAddress(await staking.read.rewardsToken()), getAddress(rewardsToken.address));
    assert.equal(getAddress(await staking.read.owner()), getAddress(owner.account.address));

    // 70,000 tokens over 7 days, fully backed by tokens in the pool.
    const funded = 70_000n * ONE;
    assert.equal(await staking.read.totalRewardsFunded(), funded);
    assert.equal(await staking.read.rewardRate(), (funded * RATE_PRECISION) / (7n * DAY));
    assert.equal(await rewardsToken.read.balanceOf([staking.address]), funded);
    assert.ok((await staking.read.periodFinish()) > (await env.latest()));
  });

  it("TestnetDemo module accepts a custom reward amount and duration", async function () {
    const { staking } = await ignition.deploy(TestnetDemoModule, {
      parameters: { TestnetDemo: { rewardAmount: 500n * ONE, rewardDuration: 2n * DAY } },
    });

    assert.equal(await staking.read.totalRewardsFunded(), 500n * ONE);
    assert.equal(await staking.read.rewardRate(), (500n * ONE * RATE_PRECISION) / (2n * DAY));
  });
});

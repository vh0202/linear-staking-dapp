import assert from "node:assert/strict";

import { getAddress, type Address } from "viem";

import type { TestEnv } from "./env.js";
import { payoutTolerance, ReferencePool } from "./reference.js";

type Wallet = TestEnv["alice"];
type Pool = Awaited<ReturnType<TestEnv["deployPool"]>>;

/**
 * Applies every action to the contract and to the exact reference model in lockstep, at
 * explicit block timestamps, and records what each account actually received.
 */
export class MirroredPool {
  readonly reference = new ReferencePool();

  /** Reward tokens transferred in / out, as observed from token balances. */
  totalFunded = 0n;
  totalPaid = 0n;

  /** Largest gap between the exact model and the contract seen so far, in reward wei. */
  maxDeviation = 0n;

  private readonly received = new Map<Address, bigint>();
  /** How often the contract has settled each account (each settlement rounds down once). */
  private readonly settlements = new Map<Address, number>();
  private readonly sameToken: boolean;
  private readonly env: TestEnv;
  readonly pool: Pool;

  constructor(env: TestEnv, pool: Pool) {
    this.env = env;
    this.pool = pool;
    this.sameToken = pool.stakingToken.address === pool.rewardsToken.address;
  }

  private static address(wallet: Wallet): Address {
    return getAddress(wallet.account.address);
  }

  private settled(account: Address): void {
    this.settlements.set(account, this.settlementsOf(account) + 1);
  }

  private pay(account: Address, amount: bigint): void {
    this.received.set(account, this.receivedBy(account) + amount);
    this.totalPaid += amount;
  }

  settlementsOf(account: Address): number {
    return this.settlements.get(account) ?? 0;
  }

  receivedBy(account: Address): bigint {
    return this.received.get(account) ?? 0n;
  }

  async fund(time: bigint, amount: bigint, duration: bigint): Promise<void> {
    const { staking } = this.pool;
    await this.env.at(time, () => staking.write.fundRewards([amount, duration], { account: this.env.owner.account }));
    this.reference.fund(time, amount, duration);
    this.totalFunded += amount;
  }

  async stake(time: bigint, wallet: Wallet, amount: bigint): Promise<void> {
    const { staking } = this.pool;
    const account = MirroredPool.address(wallet);
    await this.env.at(time, () => staking.write.stake([amount], { account: wallet.account }));
    this.reference.stake(time, account, amount);
    this.settled(account);
  }

  async unstake(time: bigint, wallet: Wallet, amount: bigint): Promise<void> {
    const { staking } = this.pool;
    const account = MirroredPool.address(wallet);
    await this.env.at(time, () => staking.write.unstake([amount], { account: wallet.account }));
    this.reference.unstake(time, account, amount);
    this.settled(account);
  }

  /** Claims and returns the reward tokens that actually arrived in the wallet. */
  async claim(time: bigint, wallet: Wallet): Promise<bigint> {
    const { staking, rewardsToken } = this.pool;
    const account = MirroredPool.address(wallet);
    const before = await rewardsToken.read.balanceOf([account]);
    await this.env.at(time, () => staking.write.claim({ account: wallet.account }));
    const paid = (await rewardsToken.read.balanceOf([account])) - before;

    this.reference.claim(time, account);
    this.pay(account, paid);
    this.settled(account);
    return paid;
  }

  /** Exits and returns the reward tokens that actually arrived (stake excluded). */
  async exit(time: bigint, wallet: Wallet): Promise<bigint> {
    const { staking, stakingToken, rewardsToken } = this.pool;
    const account = MirroredPool.address(wallet);
    const stake = this.reference.stakeOf(account);
    const stakeBefore = await stakingToken.read.balanceOf([account]);
    const rewardBefore = await rewardsToken.read.balanceOf([account]);
    await this.env.at(time, () => staking.write.exit({ account: wallet.account }));
    const stakeAfter = await stakingToken.read.balanceOf([account]);
    const rewardAfter = await rewardsToken.read.balanceOf([account]);

    // With a single token the stake and the reward arrive in the same balance.
    const paid = this.sameToken ? rewardAfter - rewardBefore - stake : rewardAfter - rewardBefore;
    if (!this.sameToken) assert.equal(stakeAfter - stakeBefore, stake, "exit returns the whole stake");

    this.reference.unstake(time, account, stake);
    this.reference.claim(time, account);
    this.pay(account, paid);
    this.settled(account);
    return paid;
  }

  /**
   * Checks, at the timestamp of the latest block, that everything each wallet has been paid
   * plus everything it can still claim equals the exact model within the stated tolerance:
   *
   *   floor(exact) - tolerance <= contract <= ceil(exact)
   */
  async assertMatchesReference(wallets: Wallet[]): Promise<void> {
    const time = await this.env.latest();
    for (const wallet of wallets) {
      const account = MirroredPool.address(wallet);
      const actual = this.receivedBy(account) + (await this.pool.staking.read.earned([account]));
      const exact = this.reference.lifetimeRewards(time, account);
      const tolerance = payoutTolerance(this.settlementsOf(account));

      assert.ok(
        actual <= exact.ceil(),
        `${account} got ${actual}, more than the exact share ${exact.floor()} (+1 wei rounding)`,
      );
      assert.ok(
        actual >= exact.floor() - tolerance,
        `${account} got ${actual}, more than ${tolerance} wei below the exact share ${exact.floor()}`,
      );

      const deviation = exact.floor() - actual;
      if (deviation > this.maxDeviation) this.maxDeviation = deviation;
    }
  }
}

import { erc20Abi, type Address, type Client } from "viem";
import { getBlock, getContractEvents, readContract } from "viem/actions";

import { linearStakingAbi } from "@/contracts/linearStakingAbi";

import { clockOffsetMs, observeBlock, type ClockObservation } from "./chainClock";

export type TokenInfo = {
  address: Address;
  symbol: string;
  decimals: number;
};

export type AccountSnapshot = {
  address: Address;
  /** Staking tokens in the wallet. */
  walletBalance: bigint;
  /** Reward tokens in the wallet. */
  rewardWalletBalance: bigint;
  /** Staking tokens the pool may pull from the wallet. */
  allowance: bigint;
  staked: bigint;
  earned: bigint;
};

/** Everything the page shows, read at one block so the numbers are consistent. */
export type PoolSnapshot = {
  blockNumber: bigint;
  blockTimestamp: bigint;
  /**
   * Estimated `chain clock - local clock` in ms (see chainClock.ts). The rewards ticker,
   * the countdown and the period progress add it to the local time, so they run on chain
   * time and do not restart with every block.
   */
  clockOffsetMs: number;
  stakingToken: TokenInfo;
  rewardsToken: TokenInfo;
  totalStaked: bigint;
  /** Scaled by 1e18, see `RATE_PRECISION`. */
  rewardRate: bigint;
  periodFinish: bigint;
  /**
   * Length of the current reward period in seconds, from the `RewardsFunded` event that
   * set `periodFinish`. Undefined when no period was funded or the event was not found.
   */
  periodDuration: bigint | undefined;
  rewardReserve: bigint;
  paused: boolean;
  account: AccountSnapshot | undefined;
};

type Tokens = Pick<PoolSnapshot, "stakingToken" | "rewardsToken">;

/**
 * First block of an event query. `lookback` limits how far back it reaches, because public
 * RPC endpoints cap the block range of eth_getLogs; undefined means the whole chain.
 */
export function eventsFromBlock(latestBlock: bigint, lookback: bigint | undefined): bigint {
  if (lookback === undefined || lookback >= latestBlock) return 0n;
  return latestBlock - lookback;
}

// Token addresses, symbols and decimals never change for a deployed pool: read them once.
const tokenCache = new Map<string, Promise<Tokens>>();

async function describeToken(client: Client, address: Address): Promise<TokenInfo> {
  const [symbol, decimals] = await Promise.all([
    readContract(client, { address, abi: erc20Abi, functionName: "symbol" }),
    readContract(client, { address, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { address, symbol, decimals };
}

function loadTokens(client: Client, staking: Address): Promise<Tokens> {
  const key = `${client.chain?.id ?? "unknown"}:${staking}`;
  let tokens = tokenCache.get(key);
  if (tokens === undefined) {
    tokens = (async () => {
      const pool = { address: staking, abi: linearStakingAbi } as const;
      const [stakingTokenAddress, rewardsTokenAddress] = await Promise.all([
        readContract(client, { ...pool, functionName: "stakingToken" }),
        readContract(client, { ...pool, functionName: "rewardsToken" }),
      ]);
      const [stakingToken, rewardsToken] = await Promise.all([
        describeToken(client, stakingTokenAddress),
        describeToken(client, rewardsTokenAddress),
      ]);
      return { stakingToken, rewardsToken };
    })();
    tokenCache.set(key, tokens);
    // A failed lookup (node down, wrong address) must not be remembered.
    tokens.catch(() => tokenCache.delete(key));
  }
  return tokens;
}

// The blocks of each pool's chain that this page has seen, for the chain clock estimate.
const clockHistories = new Map<string, readonly ClockObservation[]>();

function observeClock(key: string, blockNumber: bigint, blockTimestamp: bigint, seenAtMs: number): number {
  const history = observeBlock(clockHistories.get(key) ?? [], blockNumber, blockTimestamp, seenAtMs);
  clockHistories.set(key, history);
  return clockOffsetMs(history);
}

// The length of a reward period only changes when the owner funds again, which also moves
// `periodFinish`: look the event up once per `periodFinish`, and retry a miss only rarely.
type PeriodLookup = { periodFinish: bigint; duration: bigint | undefined; triedAtMs: number };
const periodLookups = new Map<string, PeriodLookup>();
const PERIOD_RETRY_MS = 30_000;

async function readPeriodDuration(
  client: Client,
  staking: Address,
  key: string,
  periodFinish: bigint,
  latestBlock: bigint,
  lookback: bigint | undefined,
): Promise<bigint | undefined> {
  if (periodFinish === 0n) return undefined;

  const known = periodLookups.get(key);
  if (
    known !== undefined &&
    known.periodFinish === periodFinish &&
    (known.duration !== undefined || Date.now() - known.triedAtMs < PERIOD_RETRY_MS)
  ) {
    return known.duration;
  }

  let duration: bigint | undefined;
  try {
    const logs = await getContractEvents(client, {
      address: staking,
      abi: linearStakingAbi,
      eventName: "RewardsFunded",
      fromBlock: eventsFromBlock(latestBlock, lookback),
      toBlock: latestBlock,
      strict: true,
    });
    for (const log of logs) {
      if (log.args.periodFinish === periodFinish) duration = log.args.duration;
    }
  } catch {
    // The period visual falls back to "time remaining" only; everything else still works.
    duration = undefined;
  }
  periodLookups.set(key, { periodFinish, duration, triedAtMs: Date.now() });
  return duration;
}

async function readAccount(
  client: Client,
  staking: Address,
  tokens: Tokens,
  account: Address,
  blockNumber: bigint,
): Promise<AccountSnapshot> {
  const pool = { address: staking, abi: linearStakingAbi, blockNumber } as const;
  const stakingToken = { address: tokens.stakingToken.address, abi: erc20Abi, blockNumber } as const;
  const rewardsToken = { address: tokens.rewardsToken.address, abi: erc20Abi, blockNumber } as const;

  const [walletBalance, rewardWalletBalance, allowance, staked, earned] = await Promise.all([
    readContract(client, { ...stakingToken, functionName: "balanceOf", args: [account] }),
    readContract(client, { ...rewardsToken, functionName: "balanceOf", args: [account] }),
    readContract(client, { ...stakingToken, functionName: "allowance", args: [account, staking] }),
    readContract(client, { ...pool, functionName: "stakedBalance", args: [account] }),
    readContract(client, { ...pool, functionName: "earned", args: [account] }),
  ]);
  return { address: account, walletBalance, rewardWalletBalance, allowance, staked, earned };
}

export async function fetchPoolSnapshot(
  client: Client,
  staking: Address,
  account: Address | undefined,
  /** See `eventsFromBlock`. */
  eventLookback?: bigint,
): Promise<PoolSnapshot> {
  const key = `${client.chain?.id ?? "unknown"}:${staking}`;
  const tokens = await loadTokens(client, staking);

  const block = await getBlock(client, { blockTag: "latest" });
  // Taken right away: the reads below must not count as delay in seeing the block.
  const offsetMs = observeClock(key, block.number, block.timestamp, Date.now());
  const pool = { address: staking, abi: linearStakingAbi, blockNumber: block.number } as const;

  const [totalStaked, rewardRate, periodFinish, rewardReserve, paused, accountSnapshot] = await Promise.all([
    readContract(client, { ...pool, functionName: "totalStaked" }),
    readContract(client, { ...pool, functionName: "rewardRate" }),
    readContract(client, { ...pool, functionName: "periodFinish" }),
    readContract(client, { ...pool, functionName: "rewardReserve" }),
    readContract(client, { ...pool, functionName: "paused" }),
    account === undefined ? undefined : readAccount(client, staking, tokens, account, block.number),
  ]);
  const periodDuration = await readPeriodDuration(client, staking, key, periodFinish, block.number, eventLookback);

  return {
    blockNumber: block.number,
    blockTimestamp: block.timestamp,
    clockOffsetMs: offsetMs,
    ...tokens,
    totalStaked,
    rewardRate,
    periodFinish,
    periodDuration,
    rewardReserve,
    paused,
    account: accountSnapshot,
  };
}

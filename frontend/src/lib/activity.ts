import type { Address, Client, Hash } from "viem";
import { getBlock, getBlockNumber, getContractEvents } from "viem/actions";

import { linearStakingAbi } from "@/contracts/linearStakingAbi";

import { eventsFromBlock } from "./pool";

export type ActivityKind = "staked" | "unstaked" | "claimed";

/** One `Staked`, `Unstaked` or `RewardPaid` event of the connected account. */
export type ActivityEntry = {
  kind: ActivityKind;
  /** Staking-token wei for stakes and unstakes, reward-token wei for claims. */
  amount: bigint;
  transactionHash: Hash;
  blockNumber: bigint;
  blockHash: Hash;
  logIndex: number;
};

export type ActivityItem = ActivityEntry & {
  /** Timestamp of the block, unix seconds. Undefined when the block could not be read. */
  timestamp: bigint | undefined;
};

/** How many entries the list shows. */
export const ACTIVITY_LIMIT = 3;

/** The newest `limit` entries, newest first, each log once. */
export function latestActivity(entries: readonly ActivityEntry[], limit = ACTIVITY_LIMIT): ActivityEntry[] {
  const unique = new Map<string, ActivityEntry>();
  for (const entry of entries) unique.set(`${entry.transactionHash}:${entry.logIndex}`, entry);

  return [...unique.values()]
    .sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber ? -1 : 1;
      return b.logIndex - a.logIndex;
    })
    .slice(0, limit);
}

// Block timestamps never change; keyed by hash, so a replaced chain cannot return stale ones.
const blockTimestamps = new Map<Hash, bigint>();

/**
 * The account's most recent stakes, unstakes and claims, read from the pool's own events
 * (the `account` argument is indexed in all three, so the node filters for us).
 */
export async function fetchActivity(
  client: Client,
  staking: Address,
  account: Address,
  /** See `eventsFromBlock`. */
  eventLookback?: bigint,
): Promise<ActivityItem[]> {
  // Not from viem's cache: right after a transaction the newest block is the one that matters.
  const latestBlock = await getBlockNumber(client, { cacheTime: 0 });
  const query = {
    address: staking,
    abi: linearStakingAbi,
    args: { account },
    fromBlock: eventsFromBlock(latestBlock, eventLookback),
    toBlock: latestBlock,
    strict: true,
  } as const;

  const [staked, unstaked, claimed] = await Promise.all([
    getContractEvents(client, { ...query, eventName: "Staked" }),
    getContractEvents(client, { ...query, eventName: "Unstaked" }),
    getContractEvents(client, { ...query, eventName: "RewardPaid" }),
  ]);

  const entry = (kind: ActivityKind) => (log: (typeof staked)[number] | (typeof unstaked)[number] | (typeof claimed)[number]) => ({
    kind,
    amount: log.args.amount,
    transactionHash: log.transactionHash,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    logIndex: log.logIndex,
  });
  const entries = latestActivity([
    ...staked.map(entry("staked")),
    ...unstaked.map(entry("unstaked")),
    ...claimed.map(entry("claimed")),
  ]);

  const unknown = [...new Set(entries.map(({ blockHash }) => blockHash))].filter((hash) => !blockTimestamps.has(hash));
  await Promise.all(
    unknown.map(async (blockHash) => {
      try {
        const block = await getBlock(client, { blockHash });
        blockTimestamps.set(blockHash, block.timestamp);
      } catch {
        // The entry is then shown without its age.
      }
    }),
  );

  return entries.map((item) => ({ ...item, timestamp: blockTimestamps.get(item.blockHash) }));
}

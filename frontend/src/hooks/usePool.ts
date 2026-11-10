"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";

import { appConfig } from "@/config/env";
import { chain, EVENT_LOOKBACK_BLOCKS, POLLING_INTERVAL_MS } from "@/config/wagmi";
import { fetchPoolSnapshot } from "@/lib/pool";

// What the most recent read threw; cleared by the next read that succeeds. The query
// itself forgets its error whenever it retries without data, which would make the page
// flicker between "cannot reach the node" and a loading state once a second.
let lastFailure: unknown;

/**
 * Polls the pool (and the connected account's position) from the configured chain.
 * Works without a wallet: pool-level numbers only need the public RPC endpoint.
 */
export function usePool() {
  const client = usePublicClient({ chainId: chain.id });
  const { address } = useAccount();
  const stakingAddress = appConfig.stakingAddress;

  const { data, isError, error, refetch } = useQuery({
    queryKey: ["pool", chain.id, stakingAddress ?? null, address ?? null],
    enabled: client !== undefined && stakingAddress !== undefined,
    queryFn: async () => {
      if (client === undefined || stakingAddress === undefined) throw new Error("Not configured");
      try {
        const snapshot = await fetchPoolSnapshot(client, stakingAddress, address, EVENT_LOOKBACK_BLOCKS);
        lastFailure = undefined;
        return snapshot;
      } catch (failure) {
        lastFailure = failure;
        throw failure;
      }
    },
    refetchInterval: POLLING_INTERVAL_MS,
    // Keep showing the pool numbers while the query re-keys on connect / disconnect.
    placeholderData: (previous) => previous,
    retry: false,
  });

  return {
    data,
    refetch,
    /** The last read failed, and no later one has succeeded yet. */
    failing: isError || lastFailure !== undefined,
    /** What that read threw. */
    failure: error ?? lastFailure,
  };
}

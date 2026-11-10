"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";

import { appConfig } from "@/config/env";
import { chain, EVENT_LOOKBACK_BLOCKS, POLLING_INTERVAL_MS } from "@/config/wagmi";
import { fetchActivity } from "@/lib/activity";

/**
 * The connected account's recent stakes, unstakes and claims, from the pool's events.
 * Re-read after every transaction sent from this page (see Dashboard) and on a slow
 * interval, which picks up transactions sent from elsewhere.
 */
export function useActivity() {
  const client = usePublicClient({ chainId: chain.id });
  const { address } = useAccount();
  const stakingAddress = appConfig.stakingAddress;

  return useQuery({
    queryKey: ["activity", chain.id, stakingAddress ?? null, address ?? null],
    enabled: client !== undefined && stakingAddress !== undefined && address !== undefined,
    queryFn: () => {
      if (client === undefined || stakingAddress === undefined || address === undefined) {
        throw new Error("Not connected");
      }
      return fetchActivity(client, stakingAddress, address, EVENT_LOOKBACK_BLOCKS);
    },
    refetchInterval: POLLING_INTERVAL_MS * 10,
    retry: false,
  });
}

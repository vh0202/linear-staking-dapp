import type { Chain } from "viem";
import { hardhat, sepolia } from "viem/chains";

import { LOCAL_CHAIN_ID, type AppConfig, type SupportedChainId } from "./env";

const KNOWN_CHAINS: Record<SupportedChainId, Chain> = {
  31337: { ...hardhat, name: "Hardhat Local" },
  11155111: sepolia,
};

/** The one chain this build talks to, with the configured RPC endpoint applied. */
export function resolveChain(config: Pick<AppConfig, "chainId" | "rpcUrl">): Chain {
  const chain = KNOWN_CHAINS[config.chainId];
  if (config.rpcUrl === undefined) return chain;
  return { ...chain, rpcUrls: { ...chain.rpcUrls, default: { http: [config.rpcUrl] } } };
}

export const isLocalChain = (chainId: number) => chainId === LOCAL_CHAIN_ID;

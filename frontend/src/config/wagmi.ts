import { connectorsForWallets, type WalletList } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";

import { isLocalChain, resolveChain } from "./chains";
import { demoWallet } from "./demoWallet";
import { appConfig } from "./env";

export const chain = resolveChain(appConfig);

/** How often the chain is re-read. The local node mines a block every two seconds. */
export const POLLING_INTERVAL_MS = isLocalChain(chain.id) ? 1_000 : 6_000;

/**
 * How far back event queries reach (the reward period's start, the activity list). The
 * local chain is short, so all of it is read. Public RPC endpoints cap the block range of
 * eth_getLogs, so elsewhere only the most recent blocks are searched (about a week on
 * Sepolia); anything older is simply not listed.
 */
export const EVENT_LOOKBACK_BLOCKS: bigint | undefined = isLocalChain(chain.id) ? undefined : 50_000n;

const walletGroups: WalletList = [];

if (appConfig.demoWalletAddress !== undefined) {
  walletGroups.push({ groupName: "Local demo only", wallets: [demoWallet(appConfig.demoWalletAddress)] });
}

// WalletConnect-based wallets need a project id from cloud.walletconnect.com. Without one
// only wallets injected by a browser extension are offered.
walletGroups.push({
  groupName: "Wallets",
  wallets:
    appConfig.walletConnectProjectId !== undefined
      ? [injectedWallet, metaMaskWallet, rainbowWallet, walletConnectWallet]
      : [injectedWallet],
});

const connectors = connectorsForWallets(walletGroups, {
  appName: "Linear Staking dApp (sample)",
  projectId: appConfig.walletConnectProjectId ?? "walletconnect-not-configured",
});

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors,
  transports: { [chain.id]: http(appConfig.rpcUrl, { batch: true }) },
  pollingInterval: POLLING_INTERVAL_MS,
});

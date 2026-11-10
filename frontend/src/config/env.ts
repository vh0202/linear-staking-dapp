import { getAddress, isAddress, type Address } from "viem";

/** Chains the app knows how to talk to. Selected at build time by NEXT_PUBLIC_CHAIN_ID. */
export const SUPPORTED_CHAIN_IDS = [31337, 11155111] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export const LOCAL_CHAIN_ID = 31337;
const DEFAULT_LOCAL_RPC_URL = "http://127.0.0.1:8545";

export type AppConfig = {
  chainId: SupportedChainId;
  /** JSON-RPC endpoint. Undefined means: use the chain's public default. */
  rpcUrl: string | undefined;
  /** LinearStaking contract. Undefined when it is missing or invalid (see `problems`). */
  stakingAddress: Address | undefined;
  /** Local-demo-only wallet (a built-in Hardhat test account, signed for by the local node). */
  demoWalletAddress: Address | undefined;
  walletConnectProjectId: string | undefined;
  /** Human-readable configuration problems, shown in the UI instead of failing silently. */
  problems: string[];
};

type Env = Record<string, string | undefined>;

const clean = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

function parseAddress(value: string | undefined): Address | undefined {
  return value !== undefined && isAddress(value, { strict: false }) ? getAddress(value) : undefined;
}

/**
 * Turns the NEXT_PUBLIC_* variables into a validated config. Pure, so it can be unit tested;
 * never throws, so a bad value shows up as a readable message in the page.
 */
export function parseAppConfig(env: Env): AppConfig {
  const problems: string[] = [];

  const rawChainId = clean(env.NEXT_PUBLIC_CHAIN_ID);
  let chainId: SupportedChainId = LOCAL_CHAIN_ID;
  if (rawChainId !== undefined) {
    const parsed = Number(rawChainId);
    if ((SUPPORTED_CHAIN_IDS as readonly number[]).includes(parsed)) {
      chainId = parsed as SupportedChainId;
    } else {
      problems.push(
        `NEXT_PUBLIC_CHAIN_ID "${rawChainId}" is not supported (use ${SUPPORTED_CHAIN_IDS.join(" or ")}).`,
      );
    }
  }

  let rpcUrl = clean(env.NEXT_PUBLIC_RPC_URL);
  if (rpcUrl !== undefined && !/^https?:\/\//i.test(rpcUrl)) {
    problems.push(`NEXT_PUBLIC_RPC_URL "${rpcUrl}" must start with http:// or https://.`);
    rpcUrl = undefined;
  }
  if (rpcUrl === undefined && chainId === LOCAL_CHAIN_ID) rpcUrl = DEFAULT_LOCAL_RPC_URL;

  const rawStaking = clean(env.NEXT_PUBLIC_STAKING_ADDRESS);
  const stakingAddress = parseAddress(rawStaking);
  if (rawStaking === undefined) {
    problems.push("NEXT_PUBLIC_STAKING_ADDRESS is not set.");
  } else if (stakingAddress === undefined) {
    problems.push(`NEXT_PUBLIC_STAKING_ADDRESS "${rawStaking}" is not a valid address.`);
  }

  // The demo wallet relies on a node that signs for its own test accounts, which only the
  // local Hardhat node does. It is ignored on every other chain, whatever the flag says.
  let demoWalletAddress: Address | undefined;
  if (clean(env.NEXT_PUBLIC_ENABLE_DEMO_WALLET)?.toLowerCase() === "true") {
    const rawDemo = clean(env.NEXT_PUBLIC_DEMO_WALLET_ADDRESS);
    if (chainId !== LOCAL_CHAIN_ID) {
      problems.push("NEXT_PUBLIC_ENABLE_DEMO_WALLET is only honoured on the local chain (31337); ignored.");
    } else if (parseAddress(rawDemo) === undefined) {
      problems.push("NEXT_PUBLIC_ENABLE_DEMO_WALLET is true but NEXT_PUBLIC_DEMO_WALLET_ADDRESS is not a valid address.");
    } else {
      demoWalletAddress = parseAddress(rawDemo);
    }
  }

  return {
    chainId,
    rpcUrl,
    stakingAddress,
    demoWalletAddress,
    walletConnectProjectId: clean(env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID),
    problems,
  };
}

// Next.js inlines NEXT_PUBLIC_* at build time only when they are referenced statically.
export const appConfig = parseAppConfig({
  NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
  NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
  NEXT_PUBLIC_STAKING_ADDRESS: process.env.NEXT_PUBLIC_STAKING_ADDRESS,
  NEXT_PUBLIC_ENABLE_DEMO_WALLET: process.env.NEXT_PUBLIC_ENABLE_DEMO_WALLET,
  NEXT_PUBLIC_DEMO_WALLET_ADDRESS: process.env.NEXT_PUBLIC_DEMO_WALLET_ADDRESS,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
});

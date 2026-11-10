import { describe, expect, it } from "vitest";

import { parseAppConfig } from "./env";

const STAKING = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const DEMO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("parseAppConfig", () => {
  it("defaults to the local Hardhat node", () => {
    const config = parseAppConfig({ NEXT_PUBLIC_STAKING_ADDRESS: STAKING });

    expect(config).toEqual({
      chainId: 31337,
      rpcUrl: "http://127.0.0.1:8545",
      stakingAddress: STAKING,
      demoWalletAddress: undefined,
      walletConnectProjectId: undefined,
      problems: [],
    });
  });

  it("switches to Sepolia from the environment alone", () => {
    const config = parseAppConfig({
      NEXT_PUBLIC_CHAIN_ID: "11155111",
      NEXT_PUBLIC_RPC_URL: "https://rpc.example/sepolia",
      NEXT_PUBLIC_STAKING_ADDRESS: STAKING.toLowerCase(),
      NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: " abc123 ",
    });

    expect(config.chainId).toBe(11155111);
    expect(config.rpcUrl).toBe("https://rpc.example/sepolia");
    expect(config.stakingAddress).toBe(STAKING); // checksummed
    expect(config.walletConnectProjectId).toBe("abc123");
    expect(config.problems).toEqual([]);
  });

  it("leaves the RPC URL to the chain's public default on Sepolia", () => {
    const config = parseAppConfig({ NEXT_PUBLIC_CHAIN_ID: "11155111", NEXT_PUBLIC_STAKING_ADDRESS: STAKING });
    expect(config.rpcUrl).toBeUndefined();
  });

  it("reports a missing or malformed contract address", () => {
    expect(parseAppConfig({}).problems).toEqual(["NEXT_PUBLIC_STAKING_ADDRESS is not set."]);

    const bad = parseAppConfig({ NEXT_PUBLIC_STAKING_ADDRESS: "0x1234" });
    expect(bad.stakingAddress).toBeUndefined();
    expect(bad.problems).toEqual(['NEXT_PUBLIC_STAKING_ADDRESS "0x1234" is not a valid address.']);
  });

  it("reports an unsupported chain and falls back to the local one", () => {
    const config = parseAppConfig({ NEXT_PUBLIC_CHAIN_ID: "1", NEXT_PUBLIC_STAKING_ADDRESS: STAKING });
    expect(config.chainId).toBe(31337);
    expect(config.problems[0]).toMatch(/NEXT_PUBLIC_CHAIN_ID "1" is not supported/);
  });

  it("rejects an RPC URL that is not http(s)", () => {
    const config = parseAppConfig({
      NEXT_PUBLIC_CHAIN_ID: "11155111",
      NEXT_PUBLIC_RPC_URL: "ws://example",
      NEXT_PUBLIC_STAKING_ADDRESS: STAKING,
    });
    expect(config.rpcUrl).toBeUndefined();
    expect(config.problems[0]).toMatch(/must start with http/);
  });

  describe("demo wallet", () => {
    it("is off unless the flag is exactly true", () => {
      for (const flag of [undefined, "", "false", "1", "yes"]) {
        const config = parseAppConfig({
          NEXT_PUBLIC_STAKING_ADDRESS: STAKING,
          NEXT_PUBLIC_ENABLE_DEMO_WALLET: flag,
          NEXT_PUBLIC_DEMO_WALLET_ADDRESS: DEMO,
        });
        expect(config.demoWalletAddress, `flag ${String(flag)}`).toBeUndefined();
        expect(config.problems).toEqual([]);
      }
    });

    it("is enabled on the local chain with a valid address", () => {
      const config = parseAppConfig({
        NEXT_PUBLIC_STAKING_ADDRESS: STAKING,
        NEXT_PUBLIC_ENABLE_DEMO_WALLET: "TRUE",
        NEXT_PUBLIC_DEMO_WALLET_ADDRESS: DEMO.toLowerCase(),
      });
      expect(config.demoWalletAddress).toBe(DEMO);
      expect(config.problems).toEqual([]);
    });

    it("is never enabled on a public network, even when the flag is set", () => {
      const config = parseAppConfig({
        NEXT_PUBLIC_CHAIN_ID: "11155111",
        NEXT_PUBLIC_STAKING_ADDRESS: STAKING,
        NEXT_PUBLIC_ENABLE_DEMO_WALLET: "true",
        NEXT_PUBLIC_DEMO_WALLET_ADDRESS: DEMO,
      });
      expect(config.demoWalletAddress).toBeUndefined();
      expect(config.problems[0]).toMatch(/only honoured on the local chain/);
    });

    it("needs a valid address", () => {
      const config = parseAppConfig({
        NEXT_PUBLIC_STAKING_ADDRESS: STAKING,
        NEXT_PUBLIC_ENABLE_DEMO_WALLET: "true",
      });
      expect(config.demoWalletAddress).toBeUndefined();
      expect(config.problems[0]).toMatch(/NEXT_PUBLIC_DEMO_WALLET_ADDRESS is not a valid address/);
    });
  });
});

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

// Optional local secrets for the Sepolia steps (never committed, see .env.example).
// The Hardhat keystore (`npx hardhat keystore set <NAME>`) works too and is preferred.
const envFile = fileURLToPath(new URL("./.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

// One compiler configuration for every build profile, so the tests, the gas report and a
// production deployment all use the same bytecode.
const compiler = {
  version: "0.8.38",
  settings: {
    optimizer: { enabled: true, runs: 200 },
    // Lowest EVM version that has transient storage (EIP-1153), which the reentrancy
    // guard relies on. Pinned explicitly so the bytecode does not depend on compiler defaults.
    evmVersion: "cancun",
  },
};

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: compiler,
      production: compiler,
    },
  },
  networks: {
    // Network used by `npx hardhat node`: chain id 31337, built-in test accounts.
    // Transactions are mined immediately; an empty block every 2 s keeps the chain clock
    // moving so time-based rewards advance like they would on a live network.
    node: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
      mining: { auto: true, interval: 2000 },
    },
    // JSON-RPC connection to that node, used by the local deploy/seed scripts.
    localhost: {
      type: "http",
      chainType: "l1",
      chainId: 31337,
      url: "http://127.0.0.1:8545",
    },
    // NOT EXECUTED in this repository: no RPC URL or key is configured.
    sepolia: {
      type: "http",
      chainType: "l1",
      chainId: 11155111,
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
  },
  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
  },
  test: {
    // Solidity (forge-std) fuzz and invariant tests in test/solidity.
    solidity: {
      fuzz: { runs: 1_000 },
      // failOnRevert: the handler only makes valid calls, so any revert is a finding.
      invariant: { runs: 64, depth: 100, failOnRevert: true },
    },
  },
  coverage: {
    // Mocks and the test harness are test fixtures, not product code.
    skipFiles: ["contracts/mocks/**"],
  },
});

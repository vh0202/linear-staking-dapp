# Case study: Linear Staking dApp

**Self-initiated sample project. Not client work, not audited, test tokens only.**

**What I built.** An ERC-20 staking pool with linear, time-based rewards, and the front end
to use it. Users stake a token and earn a reward token every second, pro rata to stake and
without compounding. The owner funds reward periods and can top up a running one. The
contract uses the reward-per-token accumulator, keeps principal and rewards in separate
ledgers so it stays solvent even when both are the same token, rejects fee-on-transfer
tokens, and never blocks the withdrawal of principal, not even while paused.

**What it shows.** How I test reward logic: 95 Hardhat tests (82 TypeScript, 13 Solidity
fuzz and invariant tests), an exact reference model that the contract matched to within
7 wei per account across 3,600 random steps, 100% line and statement coverage of the pool
contract, and 30 of 30 hand-written mutants killed. The front end's approve, stake, claim,
unstake and exit flows were run in a real browser against a local node.

**What it does not show.** A public deployment. The Sepolia, Etherscan and Vercel steps are
written down but were not executed.

**Stack.** Solidity 0.8.38, OpenZeppelin Contracts 5, Hardhat 3, viem, forge-std; Next.js 16,
TypeScript, wagmi, RainbowKit, Tailwind CSS; Playwright with Chrome.

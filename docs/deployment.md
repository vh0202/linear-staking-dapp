# Deployment guide: Sepolia, Etherscan verification, Vercel

> **NOT EXECUTED.** Nothing in this document has been run for this repository. No RPC
> endpoint, funded account, explorer API key or hosting account was available, and none was
> created. These are the steps the tooling in this repository is set up for; expect to adjust
> details the first time they are actually run.

## What has been checked locally instead

| Check | How | Result |
| --- | --- | --- |
| The Ignition modules deploy and wire the contracts correctly | `test/Ignition.test.ts` (4 tests, in-memory chain) | pass |
| The exact CLI commands below work, including the `--parameters` file | `hardhat ignition deploy ... --network localhost` against a local Hardhat node, without `--verify` | both modules deployed; on-chain values matched the parameters |
| The front end reads its network and contract address from the environment | unit tests in `frontend/src/config/env.test.ts` | pass |

Not checked at all: a deployment to Sepolia, `--verify` / Etherscan, a Vercel build, and the
front end running against Sepolia or with a real wallet extension.

## 1. Prerequisites

- Node.js 22.13 or newer for the Hardhat workspace (see the README for older systems).
- A Sepolia JSON-RPC URL.
- A **throw-away** Sepolia account with a little test ETH. Do not reuse a key that controls
  anything of value.
- An Etherscan API key (for verification).

## 2. Provide the three secrets

Preferred: the encrypted Hardhat keystore, which keeps them out of the repository folder.

```bash
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
npx hardhat keystore set ETHERSCAN_API_KEY
```

Alternative: copy `.env.example` to `.env` and fill it in. `.env` is git-ignored and is
loaded by `hardhat.config.ts`. Never commit it.

## 3. Deploy

Ignition asks for confirmation before it sends anything to a public network, keeps a journal
in `ignition/deployments/chain-11155111/` and can be re-run to resume an interrupted
deployment. The addresses end up in `deployed_addresses.json` in that folder.

### Option A: self-contained demo (mock tokens, pool, first reward period)

```bash
npm run deploy:sepolia
# = npx hardhat ignition deploy ignition/modules/TestnetDemo.ts --network sepolia --verify
```

This sends six transactions: two `MockERC20` deployments, the `LinearStaking` deployment
(owned by the deployer), then `mint`, `approve` and `fundRewards` for 70,000 demo reward
tokens over 7 days. To change the amount or the duration, copy
`ignition/parameters/sepolia.example.json` to `ignition/parameters/sepolia.json`, edit the
`TestnetDemo` section and add `--parameters ignition/parameters/sepolia.json`.

`MockERC20` has an open `mint`. These are test tokens without any value; anyone can mint
themselves staking tokens to try the app.

### Option B: a pool for two tokens that already exist

Copy `ignition/parameters/sepolia.example.json` to `ignition/parameters/sepolia.json`, fill
in the `LinearStaking` section (`stakingToken`, `rewardsToken`, `owner`), then:

```bash
npx hardhat ignition deploy ignition/modules/LinearStaking.ts \
  --network sepolia --parameters ignition/parameters/sepolia.json --verify
```

The pool starts without rewards. The owner starts a period with two transactions:
`rewardsToken.approve(pool, amount)` and `pool.fundRewards(amount, durationInSeconds)`.

Check the tokens against the "Known limits" in the README first: fee-on-transfer and
rebasing tokens are not supported.

## 4. Verify on Etherscan

`--verify` verifies everything right after the deployment. To do it later, or again:

```bash
npx hardhat ignition verify chain-11155111
```

or one contract by hand (constructor arguments in order: staking token, reward token, owner):

```bash
npx hardhat verify --network sepolia <LinearStaking address> <stakingToken> <rewardsToken> <owner>
```

The compiler settings used for verification are the ones in `hardhat.config.ts`
(solc 0.8.38, optimizer on with 200 runs, EVM version `cancun`); they are identical for
every build profile, so the verified bytecode is the tested bytecode.

## 5. After deploying

- Read back `stakingToken()`, `rewardsToken()`, `owner()`, `rewardRate()` and
  `periodFinish()` on the explorer and compare them with what you intended.
- If the owner should be a multisig, call `transferOwnership(multisig)` and then
  `acceptOwnership()` from the multisig. Until it accepts, the deployer stays the owner.

## 6. Front end on Vercel

1. Import the Git repository in Vercel.
2. Set **Root Directory** to `frontend`. Framework preset: Next.js. Keep the default
   install and build commands. The front end needs Node.js 20.9 or newer.
3. Add the environment variables (they are public, see `frontend/.env.example`):

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_CHAIN_ID` | `11155111` |
   | `NEXT_PUBLIC_STAKING_ADDRESS` | the `LinearStaking` address from step 3 |
   | `NEXT_PUBLIC_RPC_URL` | optional; an HTTPS Sepolia endpoint. It is visible to every visitor, so use a key that is restricted to your domain |
   | `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | optional; enables WalletConnect-based wallets |

   Do not set `NEXT_PUBLIC_ENABLE_DEMO_WALLET`. The demo wallet only exists for the local
   Hardhat node and the app ignores the flag on any other chain.
4. Deploy. `NEXT_PUBLIC_*` values are inlined at build time, so redeploy after changing one.

No code change is needed to switch networks: the chain, the RPC endpoint and the contract
address all come from these variables.

## 7. Before anything like this goes near mainnet

This is a sample project. It has not been audited; an independent audit is recommended
before mainnet. At a minimum also: put ownership behind a multisig or timelock, decide
whether pausing claims is acceptable for your users, and review the token pair against the
known limits.

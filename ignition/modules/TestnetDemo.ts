import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Self-contained demo deployment for a public testnet: two mock tokens, the staking pool
 * owned by the deployer, and a first funded reward period.
 *
 * TEST TOKENS ONLY. MockERC20 has an open `mint`, so these tokens have no value.
 *
 * Parameters (all optional):
 *   rewardAmount    reward tokens to fund, in wei     (default 70,000 tokens)
 *   rewardDuration  length of the period in seconds   (default 7 days)
 */
export default buildModule("TestnetDemo", (m) => {
  const deployer = m.getAccount(0);
  const rewardAmount = m.getParameter("rewardAmount", 70_000n * 10n ** 18n);
  const rewardDuration = m.getParameter("rewardDuration", 7n * 24n * 60n * 60n);

  const stakingToken = m.contract("MockERC20", ["Demo Stake Token", "dSTK", 18], { id: "StakingToken" });
  const rewardsToken = m.contract("MockERC20", ["Demo Reward Token", "dRWD", 18], { id: "RewardsToken" });
  const staking = m.contract("LinearStaking", [stakingToken, rewardsToken, deployer]);

  const mint = m.call(rewardsToken, "mint", [deployer, rewardAmount]);
  const approve = m.call(rewardsToken, "approve", [staking, rewardAmount], { after: [mint] });
  m.call(staking, "fundRewards", [rewardAmount, rewardDuration], { after: [approve] });

  return { stakingToken, rewardsToken, staking };
});

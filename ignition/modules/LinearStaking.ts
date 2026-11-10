import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys LinearStaking for two ERC-20 tokens that already exist.
 *
 * Parameters (see ignition/parameters/sepolia.example.json):
 *   stakingToken  token that users stake
 *   rewardsToken  token that rewards are paid in (may be the same token)
 *   owner         account allowed to fund rewards and to pause; defaults to the deployer
 */
export default buildModule("LinearStaking", (m) => {
  const stakingToken = m.getParameter<string>("stakingToken");
  const rewardsToken = m.getParameter<string>("rewardsToken");
  const owner = m.getParameter("owner", m.getAccount(0));

  const staking = m.contract("LinearStaking", [stakingToken, rewardsToken, owner]);

  return { staking };
});

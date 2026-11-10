// Hand-written mutation check for contracts/LinearStaking.sol.
//
// Each mutant below is one deliberate bug (a guard removed, a formula changed, an
// accounting step dropped). For every mutant the script patches the contract, runs the
// whole test suite and expects it to FAIL. A mutant that still passes ("survived") points
// at behaviour the tests do not pin down.
//
//   npm run test:mutation            # all mutants (several minutes)
//   npm run test:mutation -- 3 7     # only mutants #3 and #7
//
// The original file is always restored, also on Ctrl+C or when a run crashes.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = path.join(root, "contracts", "LinearStaking.sol");
const original = readFileSync(contractPath, "utf8");

/** @type {Array<{ name: string, find: string, replace: string }>} */
const MUTANTS = [
  {
    name: "accrual pays half of the emission",
    find: "(emitted * (ACC_PRECISION / RATE_PRECISION)) / staked",
    replace: "(emitted * (ACC_PRECISION / RATE_PRECISION)) / staked / 2",
  },
  {
    name: "rewards keep accruing after the period end",
    find: "return block.timestamp < periodFinish ? block.timestamp : periodFinish;",
    replace: "return block.timestamp;",
  },
  {
    name: "earned() rounds up instead of down",
    find: "(stakedBalance[account] * (accumulator - userRewardPerTokenPaid[account])) /",
    replace: "(stakedBalance[account] * (accumulator - userRewardPerTokenPaid[account]) + ACC_PRECISION - 1) /",
  },
  {
    name: "stake is not pausable",
    find: "function stake(uint256 amount) external nonReentrant whenNotPaused updateReward(msg.sender) {",
    replace: "function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {",
  },
  {
    name: "claim is not pausable",
    find: "function claim() external nonReentrant whenNotPaused updateReward(msg.sender) returns (uint256 reward) {",
    replace: "function claim() external nonReentrant updateReward(msg.sender) returns (uint256 reward) {",
  },
  {
    name: "unstake is blocked while paused",
    find: "function unstake(uint256 amount) external nonReentrant updateReward(msg.sender) {",
    replace: "function unstake(uint256 amount) external nonReentrant whenNotPaused updateReward(msg.sender) {",
  },
  {
    name: "unstake has no reentrancy guard",
    find: "function unstake(uint256 amount) external nonReentrant updateReward(msg.sender) {",
    replace: "function unstake(uint256 amount) external updateReward(msg.sender) {",
  },
  {
    name: "unstake skips the reward checkpoint",
    find: "function unstake(uint256 amount) external nonReentrant updateReward(msg.sender) {",
    replace: "function unstake(uint256 amount) external nonReentrant {",
  },
  {
    name: "stake accepts a zero amount",
    find: "        if (amount == 0) revert ZeroAmount();\n\n        totalStaked += amount;",
    replace: "        totalStaked += amount;",
  },
  {
    name: "stake skips the solvency check (fee-on-transfer accepted)",
    find: "        _requireSolvent(stakingToken);\n",
    replace: "",
  },
  {
    name: "unstake does not check the staked balance with a custom error",
    find: "        if (amount > staked) revert InsufficientStake(amount, staked);\n",
    replace: "",
  },
  {
    name: "unstake does not reduce totalStaked",
    find: "        totalStaked -= amount;\n",
    replace: "",
  },
  {
    name: "claim does not clear the paid rewards",
    find: "        rewards[account] = 0;\n",
    replace: "",
  },
  {
    name: "payouts are not recorded in totalRewardsPaid",
    find: "        totalRewardsPaid += reward;\n",
    replace: "",
  },
  {
    name: "payouts are not capped by the reward reserve",
    find: "        if (reward > reserve) revert RewardExceedsReserve(reward, reserve);\n",
    replace: "        reserve;\n",
  },
  {
    name: "exit does not pay rewards",
    find: "        reward = _takeRewards(msg.sender);\n\n        stakingToken.safeTransfer(msg.sender, amount);",
    replace: "        stakingToken.safeTransfer(msg.sender, amount);",
  },
  {
    name: "the account checkpoint is not advanced",
    find: "            userRewardPerTokenPaid[account] = accumulator;\n",
    replace: "",
  },
  {
    name: "lastUpdateTime is not advanced",
    find: "            lastUpdateTime = applicable;\n",
    replace: "",
  },
  {
    name: "emissions without stakers are dropped instead of set aside",
    find: "                unallocatedRewards += (applicable - last) * rewardRate;",
    replace: "                unallocatedRewards += 0;",
  },
  {
    name: "anyone can fund (and re-pace) rewards",
    find: ") external onlyOwner nonReentrant updateReward(address(0)) {",
    replace: ") external nonReentrant updateReward(address(0)) {",
  },
  {
    name: "minimum duration is off by one",
    find: "duration < MIN_REWARD_DURATION ||",
    replace: "duration <= MIN_REWARD_DURATION ||",
  },
  {
    name: "maximum duration is not enforced",
    find: "if (duration < MIN_REWARD_DURATION || duration > MAX_REWARD_DURATION) {",
    replace: "if (duration < MIN_REWARD_DURATION) {",
  },
  {
    name: "lifetime reward cap is not enforced",
    find: "        if (amount > available) revert RewardCapExceeded(amount, available);\n",
    replace: "",
  },
  {
    name: "top-up drops the rest of the running period",
    find: "            pool += (periodFinish - block.timestamp) * rewardRate;",
    replace: "            pool += 0;",
  },
  {
    name: "top-up counts the rest of the running period twice",
    find: "            pool += (periodFinish - block.timestamp) * rewardRate;",
    replace: "            pool += (periodFinish - block.timestamp) * rewardRate * 2;",
  },
  {
    name: "top-up forgets unallocated rewards",
    find: "uint256 pool = amount * RATE_PRECISION + unallocatedRewards;",
    replace: "uint256 pool = amount * RATE_PRECISION;",
  },
  {
    name: "funding skips the solvency check (fee-on-transfer accepted)",
    find: "        _requireSolvent(rewardsToken);\n",
    replace: "",
  },
  {
    name: "same token: solvency check ignores the reward reserve",
    find: "if (address(token) == address(rewardsToken)) owed += totalRewardsFunded - totalRewardsPaid;",
    replace:
      "if (address(token) == address(rewardsToken) && address(token) != address(stakingToken)) owed += totalRewardsFunded - totalRewardsPaid;",
  },
  {
    name: "ownership can be renounced while paused",
    find: "function renounceOwnership() public override whenNotPaused {",
    replace: "function renounceOwnership() public override {",
  },
  {
    name: "constructor accepts a zero token address",
    find: "        if (address(stakingToken_) == address(0) || address(rewardsToken_) == address(0)) {\n            revert ZeroAddress();\n        }\n",
    replace: "",
  },
];

function restore() {
  writeFileSync(contractPath, original);
}
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});

function runSuite() {
  const result = spawnSync("npx", ["hardhat", "test"], {
    cwd: root,
    shell: true,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    // A smaller random run keeps the check fast; the seeds are fixed, so this is a subset
    // of what the normal suite executes.
    env: { ...process.env, FUZZ_RUNS: process.env.FUZZ_RUNS ?? "5" },
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const ran = /\d+ passing/.test(output) || /\d+ failing/.test(output);
  const failing = [...output.matchAll(/(\d+) failing/g)].reduce((sum, match) => sum + Number(match[1]), 0);
  return { exitCode: result.status, ran, failing };
}

const selection = process.argv.slice(2).map(Number).filter(Number.isInteger);
const results = [];

try {
  for (const [index, mutant] of MUTANTS.entries()) {
    const number = index + 1;
    if (selection.length > 0 && !selection.includes(number)) continue;

    const occurrences = original.split(mutant.find).length - 1;
    if (occurrences !== 1) {
      throw new Error(`Mutant #${number} "${mutant.name}": pattern found ${occurrences} times, expected exactly 1`);
    }

    writeFileSync(contractPath, original.replace(mutant.find, mutant.replace));
    const started = Date.now();
    const { exitCode, ran, failing } = runSuite();
    const seconds = Math.round((Date.now() - started) / 1000);

    const status = !ran ? "INVALID (did not compile or run)" : exitCode === 0 ? "SURVIVED" : "killed";
    results.push({ number, name: mutant.name, status, failing });
    console.log(
      `#${String(number).padStart(2)} ${status.padEnd(8)} ${mutant.name}` +
        (status === "killed" ? ` (${failing} failing test${failing === 1 ? "" : "s"}, ${seconds}s)` : ` (${seconds}s)`),
    );
  }
} finally {
  restore();
}

// Leave the build artifacts in sync with the restored source.
spawnSync("npx", ["hardhat", "build"], { cwd: root, shell: true, stdio: "ignore" });

const killed = results.filter((result) => result.status === "killed").length;
const survived = results.filter((result) => result.status === "SURVIVED");
const invalid = results.filter((result) => result.status.startsWith("INVALID"));

console.log(`\nMutation check: ${killed} of ${results.length} mutants killed.`);
if (survived.length > 0) console.log(`Survived: ${survived.map((result) => `#${result.number}`).join(", ")}`);
if (invalid.length > 0) console.log(`Invalid: ${invalid.map((result) => `#${result.number}`).join(", ")}`);
process.exit(survived.length > 0 || invalid.length > 0 ? 1 : 0);

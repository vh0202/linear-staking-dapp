import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/**
 * ERC-6093 errors thrown by the tokens (OpenZeppelin ERC-20). They are appended to the ABI
 * used for simulations so a revert inside the token can be decoded by name too.
 */
export const erc20ErrorsAbi = [
  {
    type: "error",
    name: "ERC20InsufficientBalance",
    inputs: [
      { name: "sender", type: "address" },
      { name: "balance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ERC20InsufficientAllowance",
    inputs: [
      { name: "spender", type: "address" },
      { name: "allowance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
] as const;

const FRIENDLY_REVERTS: Record<string, string> = {
  ZeroAmount: "Enter an amount greater than zero.",
  InsufficientStake: "You cannot unstake more than you have staked.",
  EnforcedPause: "The pool is paused: staking and claiming are disabled. Unstaking still works.",
  ERC20InsufficientBalance: "Your token balance is too low for this amount.",
  ERC20InsufficientAllowance: "The pool is not approved to move that many tokens. Approve first.",
  InsufficientTokenBalance: "The token delivered less than was sent. Fee-on-transfer tokens are not supported.",
  RewardExceedsReserve: "The reward pool cannot cover this payout. Nothing was paid.",
  ReentrancyGuardReentrantCall: "The pool rejected a re-entrant call.",
};

/** Turns anything thrown while sending a transaction into one sentence a user can act on. */
export function describeError(error: unknown): string {
  if (error instanceof BaseError) {
    if (error.walk((cause) => cause instanceof UserRejectedRequestError)) {
      return "You rejected the request in your wallet.";
    }

    const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name !== undefined && name in FRIENDLY_REVERTS) return FRIENDLY_REVERTS[name];
      if (name !== undefined) return `The contract rejected the transaction (${name}).`;
      if (revert.reason !== undefined) return `The contract rejected the transaction: ${revert.reason}`;
      return "The contract rejected the transaction.";
    }

    return error.shortMessage;
  }
  if (error instanceof Error && error.message !== "") return error.message;
  return "Something went wrong. Nothing was sent.";
}

import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  UserRejectedRequestError,
} from "viem";
import { describe, expect, it } from "vitest";

import { linearStakingAbi } from "@/contracts/linearStakingAbi";

import { describeError, erc20ErrorsAbi } from "./errors";

const abi = [...linearStakingAbi, ...erc20ErrorsAbi] as const;

/** Builds the error viem throws when a simulated call reverts with the given custom error. */
function revertWith(data: `0x${string}`, functionName = "stake", args: readonly unknown[] = [1n]) {
  const revert = new ContractFunctionRevertedError({ abi, data, functionName });
  return new ContractFunctionExecutionError(revert, { abi, functionName, args });
}

describe("describeError", () => {
  it("explains known contract errors in plain words", () => {
    expect(describeError(revertWith(encodeErrorResult({ abi, errorName: "ZeroAmount" })))).toBe(
      "Enter an amount greater than zero.",
    );
    expect(
      describeError(revertWith(encodeErrorResult({ abi, errorName: "InsufficientStake", args: [2n, 1n] }), "unstake")),
    ).toBe("You cannot unstake more than you have staked.");
    expect(describeError(revertWith(encodeErrorResult({ abi, errorName: "EnforcedPause" })))).toMatch(/paused/);
  });

  it("decodes errors thrown by the token, not only by the pool", () => {
    const data = encodeErrorResult({
      abi,
      errorName: "ERC20InsufficientBalance",
      args: ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8", 1n, 2n],
    });
    expect(describeError(revertWith(data))).toBe("Your token balance is too low for this amount.");
  });

  it("names contract errors it has no wording for", () => {
    const data = encodeErrorResult({ abi, errorName: "InvalidDuration", args: [5n] });
    expect(describeError(revertWith(data, "fundRewards", [1n, 5n]))).toBe(
      "The contract rejected the transaction (InvalidDuration).",
    );
  });

  it("falls back to a generic sentence for an undecodable revert", () => {
    expect(describeError(revertWith("0xdeadbeef"))).toBe("The contract rejected the transaction.");
  });

  it("recognises a request rejected in the wallet, however deeply it is wrapped", () => {
    const rejected = new UserRejectedRequestError(new Error("User denied transaction signature"));
    expect(describeError(rejected)).toBe("You rejected the request in your wallet.");
    expect(describeError(new BaseError("Transaction failed", { cause: rejected }))).toBe(
      "You rejected the request in your wallet.",
    );
  });

  it("uses viem's short message for other RPC errors", () => {
    expect(describeError(new BaseError("HTTP request failed."))).toBe("HTTP request failed.");
  });

  it("copes with plain errors and non-errors", () => {
    expect(describeError(new Error("The transaction was mined but reverted."))).toBe(
      "The transaction was mined but reverted.",
    );
    expect(describeError("boom")).toBe("Something went wrong. Nothing was sent.");
    expect(describeError(undefined)).toBe("Something went wrong. Nothing was sent.");
  });
});

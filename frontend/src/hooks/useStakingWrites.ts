"use client";

import { useMemo } from "react";
import { erc20Abi, type Address, type Hash } from "viem";
import { simulateContract } from "viem/actions";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";

import { chain } from "@/config/wagmi";
import { linearStakingAbi } from "@/contracts/linearStakingAbi";
import { erc20ErrorsAbi } from "@/lib/errors";

// Pool ABI plus the token's own errors, so a revert inside the token is decoded by name.
const poolAbi = [...linearStakingAbi, ...erc20ErrorsAbi] as const;
const tokenAbi = [...erc20Abi, ...erc20ErrorsAbi] as const;

/**
 * The transactions the page can send. Each one is simulated against the node first, so a
 * call that would revert is reported with its decoded reason instead of being sent.
 */
export function useStakingWrites(staking: Address, stakingToken: Address) {
  const client = usePublicClient({ chainId: chain.id });
  const { address: account } = useAccount();
  const { writeContractAsync } = useWriteContract();

  return useMemo(() => {
    const ready = () => {
      if (client === undefined || account === undefined) throw new Error("Connect a wallet first.");
      return { client, account };
    };

    return {
      approve: (amount: bigint) => async (): Promise<Hash> => {
        const { client, account } = ready();
        const call = {
          address: stakingToken,
          abi: tokenAbi,
          functionName: "approve",
          args: [staking, amount],
        } as const;
        await simulateContract(client, { ...call, account });
        return writeContractAsync({ ...call, chainId: chain.id });
      },

      stake: (amount: bigint) => async (): Promise<Hash> => {
        const { client, account } = ready();
        const call = { address: staking, abi: poolAbi, functionName: "stake", args: [amount] } as const;
        await simulateContract(client, { ...call, account });
        return writeContractAsync({ ...call, chainId: chain.id });
      },

      unstake: (amount: bigint) => async (): Promise<Hash> => {
        const { client, account } = ready();
        const call = { address: staking, abi: poolAbi, functionName: "unstake", args: [amount] } as const;
        await simulateContract(client, { ...call, account });
        return writeContractAsync({ ...call, chainId: chain.id });
      },

      claim: () => async (): Promise<Hash> => {
        const { client, account } = ready();
        const call = { address: staking, abi: poolAbi, functionName: "claim" } as const;
        await simulateContract(client, { ...call, account });
        return writeContractAsync({ ...call, chainId: chain.id });
      },

      exit: () => async (): Promise<Hash> => {
        const { client, account } = ready();
        const call = { address: staking, abi: poolAbi, functionName: "exit" } as const;
        await simulateContract(client, { ...call, account });
        return writeContractAsync({ ...call, chainId: chain.id });
      },
    };
  }, [client, account, writeContractAsync, staking, stakingToken]);
}

"use client";

import { useCallback, useRef, useState } from "react";
import type { Hash } from "viem";
import { waitForTransactionReceipt } from "viem/actions";
import { usePublicClient } from "wagmi";

import { chain } from "@/config/wagmi";
import { describeError } from "@/lib/errors";
import { pushToast } from "@/lib/toasts";

/** Life cycle of one transaction, as shown to the user. */
export type TxState =
  | { phase: "idle" }
  | { phase: "signing"; label: string; step: string }
  | { phase: "pending"; label: string; step: string; hash: Hash }
  | { phase: "confirmed"; label: string; step: string; hash: Hash; blockNumber: bigint }
  | { phase: "failed"; label: string; step: string; message: string; hash?: Hash };

export type TxRequest = {
  /** Name of the transaction in status messages: "Stake", "Approve STK". */
  label: string;
  /** Which step of a flow this is ("approve", "stake", ...), for the step indicator. */
  step: string;
  /** Simulates and sends the transaction; resolves with its hash. */
  send: () => Promise<Hash>;
  /** One sentence for the confirmation toast: what is true now. */
  summary?: string;
};

/**
 * Runs a transaction and tracks it: waiting for the wallet -> pending -> confirmed / failed.
 * A confirmation is also announced with a toast; a failure stays next to the button that
 * caused it, with its reason and a way to try again.
 *
 * @param onConfirmed Awaited after the receipt arrives and before the state turns
 *                    "confirmed", so fresh on-chain data is on screen by then.
 */
export function useTransaction(onConfirmed?: () => Promise<unknown>) {
  const client = usePublicClient({ chainId: chain.id });
  const [state, setState] = useState<TxState>({ phase: "idle" });
  const lastRequest = useRef<TxRequest | undefined>(undefined);

  const run = useCallback(
    async (request: TxRequest): Promise<boolean> => {
      const { label, step, send, summary } = request;
      lastRequest.current = request;

      let hash: Hash | undefined;
      setState({ phase: "signing", label, step });
      try {
        if (client === undefined) throw new Error("No connection to the network.");
        hash = await send();
        setState({ phase: "pending", label, step, hash });

        const receipt = await waitForTransactionReceipt(client, { hash });
        if (receipt.status !== "success") throw new Error("The transaction was mined but reverted.");

        await onConfirmed?.();
        setState({ phase: "confirmed", label, step, hash, blockNumber: receipt.blockNumber });
        pushToast({
          tone: "success",
          title: `${label} confirmed`,
          description: summary ?? `Included in block ${receipt.blockNumber.toString()}.`,
        });
        return true;
      } catch (error) {
        setState({ phase: "failed", label, step, message: describeError(error), hash });
        return false;
      }
    },
    [client, onConfirmed],
  );

  /** Sends the last transaction again, unchanged. */
  const retry = useCallback(async (): Promise<boolean> => {
    return lastRequest.current === undefined ? false : run(lastRequest.current);
  }, [run]);

  /** Clears a finished transaction's message. Does nothing while one is in flight. */
  const reset = useCallback(() => {
    setState((current) => (current.phase === "confirmed" || current.phase === "failed" ? { phase: "idle" } : current));
  }, []);

  const busy = state.phase === "signing" || state.phase === "pending";
  return { state, busy, run, retry, reset };
}

export type Transaction = ReturnType<typeof useTransaction>;

import type { ReactNode } from "react";

import type { TxState } from "@/hooks/useTransaction";

import { HashChip } from "./HashChip";
import { CheckIcon, DrawnCheck, ErrorIcon, RetryIcon, Spinner } from "./icons";
import { cx, quietButtonClass } from "./ui";

type TxStatusProps = {
  state: TxState;
  /** Shown while nothing is in flight: a hint, or the reason the form is unavailable. */
  idle?: ReactNode;
  /** Sends the failed transaction again. */
  onRetry?: () => void;
  testId: string;
};

const BOX: Record<Exclude<TxState["phase"], "idle">, string> = {
  signing: "border-warning-line bg-warning-soft",
  pending: "border-accent-line bg-accent-soft",
  confirmed: "border-success-line bg-success-soft animate-flash",
  failed: "border-danger-line bg-danger-soft",
};

/**
 * The visible state of a transaction: waiting for the wallet, pending with its hash,
 * confirmed with its block, or failed with the reason and a way to try again. Each state has
 * its own icon and wording, not only its own colour, and the whole region is announced to
 * assistive technology (aria-live).
 */
export function TxStatus({ state, idle, onRetry, testId }: TxStatusProps) {
  if (state.phase === "idle") {
    return (
      <div role="status" aria-live="polite" data-testid={testId} data-phase="idle" className="min-h-14">
        <p className="text-caption text-ink-3">{idle}</p>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testId}
      data-phase={state.phase}
      className={cx("flex min-h-14 items-start gap-3 rounded-md border px-3.5 py-2.5", BOX[state.phase])}
    >
      <span className="mt-0.5 shrink-0">
        {state.phase === "signing" && <Spinner className="h-4 w-4 text-warning" />}
        {state.phase === "pending" && <Spinner className="h-4 w-4 text-accent-ink" />}
        {state.phase === "confirmed" && (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-success text-bg animate-pop">
            <DrawnCheck className="h-3 w-3" />
          </span>
        )}
        {state.phase === "failed" && <ErrorIcon className="h-4 w-4 text-danger" />}
      </span>

      <div className="min-w-0 flex-1 text-body text-ink">
        {state.phase === "signing" && <p>{state.label}: confirm in your wallet</p>}

        {state.phase === "pending" && (
          <>
            <p>{state.label} pending, waiting for a block</p>
            <HashChip value={state.hash} kind="tx" />
          </>
        )}

        {state.phase === "confirmed" && (
          <>
            <p>
              {state.label} confirmed in block {state.blockNumber.toString()}
            </p>
            <HashChip value={state.hash} kind="tx" />
          </>
        )}

        {state.phase === "failed" && (
          <>
            <p>
              <span className="font-semibold">{state.label} failed.</span> {state.message}
            </p>
            {state.hash !== undefined && <HashChip value={state.hash} kind="tx" />}
            {onRetry !== undefined && (
              <button type="button" onClick={onRetry} data-testid={`${testId}-retry`} className={cx(quietButtonClass, "mt-2")}>
                <RetryIcon className="h-3.5 w-3.5" />
                Try again
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export type StepState = "todo" | "current" | "signing" | "pending" | "done" | "failed";

const NODE: Record<StepState, string> = {
  todo: "border-line-strong text-ink-3",
  current: "border-accent text-accent-ink shadow-glow",
  signing: "border-warning text-warning",
  pending: "border-accent text-accent-ink",
  done: "border-success bg-success text-bg",
  failed: "border-danger text-danger",
};

type StepProps = {
  number: number;
  title: string;
  /** What this step is waiting for or has done, in words. */
  caption: string;
  state: StepState;
};

function Step({ number, title, caption, state }: StepProps) {
  return (
    <li data-state={state} aria-current={state === "current" || state === "signing" || state === "pending" ? "step" : undefined} className="flex min-w-0 items-center gap-2.5">
      <span
        className={cx(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-caption font-semibold transition-colors duration-200 ease-standard",
          NODE[state],
        )}
      >
        {state === "done" && <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.6} />}
        {(state === "signing" || state === "pending") && <Spinner className="h-3.5 w-3.5" />}
        {state === "failed" && <span aria-hidden="true">!</span>}
        {(state === "todo" || state === "current") && number}
      </span>
      <span className="min-w-0">
        <span className={cx("block truncate text-caption font-semibold", state === "todo" ? "text-ink-2" : "text-ink")}>{title}</span>
        <span className="block truncate text-caption text-ink-3">{caption}</span>
      </span>
    </li>
  );
}

/** The two transactions of a first stake, with the state of each. */
export function Stepper({ steps, label }: { steps: [StepProps, StepProps]; label: string }) {
  const [first, second] = steps;
  return (
    <ol aria-label={label} data-testid="stake-steps" className="flex items-center gap-3">
      <Step {...first} />
      <li aria-hidden="true" className="h-0.5 min-w-4 flex-1 overflow-hidden rounded-full bg-line-strong">
        <span
          className={cx(
            "block h-full origin-left bg-success transition-transform duration-250 ease-standard",
            first.state === "done" ? "scale-x-100" : "scale-x-0",
          )}
        />
      </li>
      <Step {...second} />
    </ol>
  );
}

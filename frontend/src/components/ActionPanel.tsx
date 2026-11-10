"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { formatUnits } from "viem";

import { chain } from "@/config/wagmi";
import { useHasLiveRewards } from "@/hooks/useLive";
import { useStakingWrites } from "@/hooks/useStakingWrites";
import { useTransaction, type Transaction } from "@/hooks/useTransaction";
import { formatPercent, formatTokenAmount } from "@/lib/format";
import type { AccountSnapshot, PoolSnapshot } from "@/lib/pool";
import { accountRewardPerDay, poolShareBps } from "@/lib/rewards";
import { validateAmount, type AmountValidation } from "@/lib/validation";

import { AmountField } from "./AmountField";
import { ExitIcon, InfoIcon, RewardIcon, Spinner, StakeIcon, UnstakeIcon } from "./icons";
import { LiveRewards } from "./PositionCard";
import { Stepper, TxStatus, type StepState } from "./TxStatus";
import { Card, cx, LiveDot, primaryButtonClass, secondaryButtonClass } from "./ui";

/** Why nothing can be sent at all right now. */
export type Gate = "disconnected" | "wrong-network" | undefined;

type PanelProps = {
  staking: `0x${string}`;
  snapshot: PoolSnapshot;
  account: AccountSnapshot | undefined;
  gate: Gate;
  /** True while the reward period is running. */
  periodActive: boolean;
  tx: Transaction;
};

/** The words for a closed gate: on the button, and in the line under it. */
function gateCopy(gate: Gate, verb: string): { label: string; detail: string } | undefined {
  if (gate === "disconnected") return { label: `Connect a wallet to ${verb}`, detail: "Connect a wallet to continue." };
  if (gate === "wrong-network") {
    return { label: "Wrong network", detail: `Switch your wallet to ${chain.name} to continue.` };
  }
  return undefined;
}

const PAUSED_DETAIL = "The pool is paused: staking and claiming are disabled. Unstaking still works.";

/** The reason a typed amount cannot be sent, short enough for a button. */
function amountProblem(validation: AmountValidation, tooMuch: string): string | undefined {
  if (validation.ok) return undefined;
  switch (validation.reason) {
    case "empty":
    case "zero":
      return "Enter an amount";
    case "invalid":
      return "Enter a valid amount";
    case "too-many-decimals":
      return "Too many decimals";
    case "exceeds-max":
      return tooMuch;
  }
}

function busyLabel(tx: Transaction, sending: string): ReactNode {
  return (
    <>
      <Spinner className="h-4 w-4" />
      {tx.state.phase === "signing" ? "Confirm in your wallet" : sending}
    </>
  );
}

/** What the position will look like once the transaction is confirmed. */
function Preview({ rows, placeholder }: { rows: [label: string, before: string, after: string][] | undefined; placeholder: string }) {
  return (
    <div className="mt-4 flex min-h-[5.25rem] flex-col justify-center border-t border-line pt-3.5">
      {rows === undefined ? (
        <p className="text-caption text-ink-3">{placeholder}</p>
      ) : (
        <dl data-testid="preview" className="space-y-1.5">
          {rows.map(([label, before, after]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 text-caption">
              <dt className="text-ink-2">{label}</dt>
              <dd className="text-right font-medium text-ink">
                <span className="font-normal text-ink-3">{before} → </span>
                {after}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** The three figures a stake or an unstake changes, before and after. */
function positionRows(snapshot: PoolSnapshot, staked: bigint, delta: bigint, periodActive: boolean): [string, string, string][] {
  const { stakingToken, rewardsToken, totalStaked, rewardRate } = snapshot;
  const amount = (value: bigint) => `${formatTokenAmount(value, stakingToken.decimals)} ${stakingToken.symbol}`;
  const perDay = (mine: bigint, total: bigint) =>
    periodActive
      ? `${formatTokenAmount(accountRewardPerDay(mine, total, rewardRate), rewardsToken.decimals, 2, "nearest")} ${rewardsToken.symbol}`
      : "none";

  return [
    ["Your stake", amount(staked), amount(staked + delta)],
    ["Share of the pool", formatPercent(poolShareBps(staked, totalStaked)), formatPercent(poolShareBps(staked + delta, totalStaked + delta))],
    ["Rewards per day", perDay(staked, totalStaked), perDay(staked + delta, totalStaked + delta)],
  ];
}

/**
 * Stake form with the ERC-20 two-step flow: approve the pool for the amount, then stake.
 * The button always performs the step that is still missing, and the step indicator shows
 * where each of the two transactions stands.
 */
function StakePanel({ staking, snapshot, account, gate, periodActive, tx }: PanelProps) {
  const token = snapshot.stakingToken;
  const [input, setInput] = useState("");
  const writes = useStakingWrites(staking, token.address);

  const balance = account?.walletBalance ?? 0n;
  const validation = validateAmount(
    input,
    token.decimals,
    balance,
    `You only have ${formatTokenAmount(balance, token.decimals)} ${token.symbol} in your wallet`,
  );
  const amount = validation.ok ? validation.amount : undefined;
  const needsApproval = amount !== undefined && (account?.allowance ?? 0n) < amount;

  const closed = gateCopy(gate, "stake") ?? (snapshot.paused ? { label: "Staking is paused", detail: PAUSED_DETAIL } : undefined);
  const empty = closed === undefined && account !== undefined && balance === 0n;
  const disabled = closed !== undefined || tx.busy;

  const change = (value: string) => {
    tx.reset();
    setInput(value);
  };

  const submit = async () => {
    if (amount === undefined) return;
    const pretty = `${formatTokenAmount(amount, token.decimals)} ${token.symbol}`;
    if (needsApproval) {
      await tx.run({
        label: `Approve ${token.symbol}`,
        step: "approve",
        send: writes.approve(amount),
        summary: `The pool may now move ${pretty}. Next: stake.`,
      });
      return;
    }
    const staked = await tx.run({
      label: "Stake",
      step: "stake",
      send: writes.stake(amount),
      summary: `${pretty} staked and earning.`,
    });
    if (staked) setInput("");
  };

  // Where each of the two steps stands: from the transaction in flight, else from the chain.
  const phase = tx.state.phase;
  const txStep = tx.state.phase === "idle" ? undefined : tx.state.step;
  let approve: StepState;
  if (txStep === "approve" && (phase === "signing" || phase === "pending" || phase === "failed")) approve = phase;
  else if (txStep === "stake" && phase !== "failed") approve = "done";
  else if (amount !== undefined) approve = needsApproval ? "current" : "done";
  else approve = txStep === "approve" && phase === "confirmed" ? "done" : "todo";

  let stake: StepState;
  if (txStep === "stake" && phase !== "idle") stake = phase === "confirmed" ? "done" : phase;
  else stake = amount !== undefined && !needsApproval ? "current" : "todo";

  const approveCaption: Record<StepState, string> = {
    todo: "Exact amount only",
    current: "Needs approval",
    signing: "Confirm in wallet",
    pending: "Pending",
    done: "Approved",
    failed: "Failed",
  };
  const stakeCaption: Record<StepState, string> = {
    todo: "After approval",
    current: "Ready",
    signing: "Confirm in wallet",
    pending: "Pending",
    done: "Staked",
    failed: "Failed",
  };

  let label: ReactNode;
  if (closed !== undefined) label = closed.label;
  else if (tx.busy) label = busyLabel(tx, txStep === "approve" ? "Approving" : "Staking");
  else if (empty) label = `No ${token.symbol} in this wallet`;
  else label = amountProblem(validation, `Not enough ${token.symbol}`) ?? (needsApproval ? `Approve ${token.symbol}` : "Stake");

  return (
    <>
      <AmountField
        id="stake-amount"
        label="Amount to stake"
        symbol={token.symbol}
        tint={0}
        value={input}
        onChange={change}
        onMax={() => change(formatUnits(balance, token.decimals))}
        available={
          account === undefined ? (
            "Wallet: not connected"
          ) : (
            <>
              Wallet: {formatTokenAmount(balance, token.decimals)} {token.symbol}
            </>
          )
        }
        error={validation.ok ? "" : validation.message}
        disabled={disabled || empty}
      />

      <div className="mt-2">
        <Stepper
          label="Steps to stake"
          steps={[
            { number: 1, title: `Approve ${token.symbol}`, caption: approveCaption[approve], state: approve },
            { number: 2, title: "Stake", caption: stakeCaption[stake], state: stake },
          ]}
        />
      </div>

      <Preview
        rows={amount === undefined ? undefined : positionRows(snapshot, account?.staked ?? 0n, amount, periodActive)}
        placeholder={
          empty
            ? `This wallet holds no ${token.symbol}, so there is nothing to stake. Tokens you unstake come back to this wallet.`
            : "Enter an amount to see your stake, your share of the pool and your daily rewards after staking."
        }
      />

      <button
        type="button"
        data-testid="stake-submit"
        className={cx(primaryButtonClass, "mt-4")}
        disabled={disabled || amount === undefined}
        onClick={submit}
      >
        {label}
      </button>

      <div className="mt-3">
        <TxStatus
          testId="stake-status"
          state={tx.state}
          // Trying again is pressing the button again: it re-checks the allowance first.
          onRetry={closed === undefined ? submit : undefined}
          idle={closed?.detail ?? "The approval covers exactly the amount you enter. No lock-up: unstake at any time."}
        />
      </div>
    </>
  );
}

/** Withdraw part of the stake, or all of it with MAX. Rewards stay claimable. */
function UnstakePanel({ staking, snapshot, account, gate, periodActive, tx }: PanelProps) {
  const token = snapshot.stakingToken;
  const [input, setInput] = useState("");
  const writes = useStakingWrites(staking, token.address);

  const staked = account?.staked ?? 0n;
  const validation = validateAmount(
    input,
    token.decimals,
    staked,
    `You only have ${formatTokenAmount(staked, token.decimals)} ${token.symbol} staked`,
  );
  const amount = validation.ok ? validation.amount : undefined;

  // Never closed by a pause: the contract lets principal out at any time.
  const closed = gateCopy(gate, "unstake");
  const empty = closed === undefined && account !== undefined && staked === 0n;
  const disabled = closed !== undefined || tx.busy;

  const change = (value: string) => {
    tx.reset();
    setInput(value);
  };

  const submit = async () => {
    if (amount === undefined) return;
    const done = await tx.run({
      label: "Unstake",
      step: "unstake",
      send: writes.unstake(amount),
      summary: `${formatTokenAmount(amount, token.decimals)} ${token.symbol} returned to your wallet.`,
    });
    if (done) setInput("");
  };

  let label: ReactNode;
  if (closed !== undefined) label = closed.label;
  else if (tx.busy) label = busyLabel(tx, "Unstaking");
  else if (empty) label = "Nothing staked";
  else label = amountProblem(validation, "More than you have staked") ?? "Unstake";

  return (
    <>
      <AmountField
        id="unstake-amount"
        label="Amount to unstake"
        symbol={token.symbol}
        tint={0}
        value={input}
        onChange={change}
        onMax={() => change(formatUnits(staked, token.decimals))}
        available={
          account === undefined ? (
            "Staked: not connected"
          ) : (
            <>
              Staked: {formatTokenAmount(staked, token.decimals)} {token.symbol}
            </>
          )
        }
        error={validation.ok ? "" : validation.message}
        disabled={disabled || empty}
      />

      {/* As tall as the step indicator of the stake tab, so the panel keeps its shape. */}
      <p className="mt-2 flex min-h-10 items-center gap-2 text-caption text-ink-2">
        <InfoIcon className="h-4 w-4 shrink-0 text-ink-3" />
        {snapshot.paused
          ? "Unstaking stays available while the pool is paused."
          : "No lock-up, no fee. Earned rewards stay claimable."}
      </p>

      <Preview
        rows={amount === undefined ? undefined : positionRows(snapshot, staked, -amount, periodActive)}
        placeholder={
          empty
            ? "You have nothing staked in this pool yet."
            : "Enter an amount to see your stake, your share of the pool and your daily rewards after unstaking."
        }
      />

      <button
        type="button"
        data-testid="unstake-submit"
        className={cx(primaryButtonClass, "mt-4")}
        disabled={disabled || amount === undefined}
        onClick={submit}
      >
        {label}
      </button>

      <div className="mt-3">
        <TxStatus
          testId="unstake-status"
          state={tx.state}
          onRetry={closed === undefined ? submit : undefined}
          idle={closed?.detail ?? "Your tokens go straight back to the connected wallet."}
        />
      </div>
    </>
  );
}

/** Claim accrued rewards, or leave the pool completely (unstake everything and claim). */
function ClaimPanel({ staking, snapshot, account, gate, periodActive, tx }: PanelProps) {
  const { stakingToken, rewardsToken } = snapshot;
  const writes = useStakingWrites(staking, stakingToken.address);
  const claimable = useHasLiveRewards();

  const staked = account?.staked ?? 0n;
  const closed = gateCopy(gate, "claim") ?? (snapshot.paused ? { label: "Claiming is paused", detail: PAUSED_DETAIL } : undefined);
  const disabled = closed !== undefined || tx.busy;
  const earning = periodActive && staked > 0n;
  const step = tx.state.phase === "idle" ? undefined : tx.state.step;

  let claimLabel: ReactNode;
  if (closed !== undefined) claimLabel = closed.label;
  else if (tx.busy && step === "claim") claimLabel = busyLabel(tx, "Claiming");
  else if (!claimable) claimLabel = "Nothing to claim yet";
  else claimLabel = "Claim rewards";

  let exitHint: string;
  if (snapshot.paused && gate === undefined) exitHint = "Paused with the pool. To withdraw now, use Unstake: it always works.";
  else if (closed !== undefined) exitHint = closed.detail;
  else if (staked === 0n) exitHint = "You have nothing staked, so there is nothing to exit.";
  else {
    exitHint = `Unstakes all ${formatTokenAmount(staked, stakingToken.decimals)} ${stakingToken.symbol} and claims your rewards in one transaction.`;
  }

  return (
    <>
      <div className="rounded-lg border border-line bg-sunken p-4">
        <p className="flex items-center justify-between gap-3 text-caption font-medium text-ink-2">
          Claimable now
          {earning && (
            <span className="inline-flex items-center gap-1.5 text-micro font-semibold uppercase text-success">
              <LiveDot />
              Live
            </span>
          )}
        </p>
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
          <LiveRewards testId="rewards-claimable" decimals={rewardsToken.decimals} className="text-headline font-semibold text-ink" />
          <span className="text-lead font-semibold text-ink-3">{rewardsToken.symbol}</span>
        </p>
        <p className="mt-2 text-caption text-ink-3">
          {claimable
            ? "Paid to your wallet in full. Claiming does not touch your stake."
            : staked > 0n
              ? periodActive
                ? "Your stake has just started earning. Rewards appear here second by second."
                : "No reward period is running, so nothing is accruing right now."
              : "Rewards accrue every second once you have a stake, in proportion to your share of the pool."}
        </p>
      </div>

      <button
        type="button"
        data-testid="claim-submit"
        className={cx(primaryButtonClass, "mt-4")}
        disabled={disabled || !claimable}
        onClick={() =>
          tx.run({
            label: "Claim",
            step: "claim",
            send: writes.claim(),
            summary: `Your ${rewardsToken.symbol} rewards are in your wallet.`,
          })
        }
      >
        <RewardIcon className="h-4 w-4" />
        {claimLabel}
      </button>

      <div className="mt-3">
        <TxStatus
          testId="rewards-status"
          state={tx.state}
          onRetry={closed === undefined ? tx.retry : undefined}
          idle={closed?.detail ?? "Rewards are linear in time and pro rata to stake. They do not compound."}
        />
      </div>

      <div className="mt-auto border-t border-line pt-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-body font-semibold text-ink">Leave the pool</p>
            <p id="exit-hint" className="mt-0.5 text-caption text-ink-3">
              {exitHint}
            </p>
          </div>
          <button
            type="button"
            data-testid="exit-submit"
            aria-describedby="exit-hint"
            className={cx(secondaryButtonClass, "shrink-0")}
            disabled={disabled || staked === 0n}
            onClick={() =>
              tx.run({
                label: "Exit",
                step: "exit",
                send: writes.exit(),
                summary: "Your stake and your rewards are back in your wallet.",
              })
            }
          >
            {tx.busy && step === "exit" ? <Spinner className="h-4 w-4" /> : <ExitIcon className="h-4 w-4" />}
            Exit pool
          </button>
        </div>
      </div>
    </>
  );
}

const TABS = [
  { id: "stake", label: "Stake", icon: <StakeIcon className="h-4 w-4" /> },
  { id: "unstake", label: "Unstake", icon: <UnstakeIcon className="h-4 w-4" /> },
  { id: "claim", label: "Claim", icon: <RewardIcon className="h-4 w-4" /> },
] as const;

type TabId = (typeof TABS)[number]["id"];

type ActionPanelProps = Omit<PanelProps, "tx"> & {
  /** Re-reads the chain; awaited before a transaction is reported as confirmed. */
  refresh: () => Promise<unknown>;
};

/**
 * Stake, unstake and claim as one panel with three tabs. Every tab keeps its own input and
 * its own transaction state, so switching tabs while something is pending loses nothing;
 * a spinner on the tab shows where a transaction is still in flight.
 */
export function ActionPanel({ refresh, ...panel }: ActionPanelProps) {
  const [active, setActive] = useState<TabId>("stake");
  const transactions: Record<TabId, Transaction> = {
    stake: useTransaction(refresh),
    unstake: useTransaction(refresh),
    claim: useTransaction(refresh),
  };
  const tabs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  // Arrow keys move between the tabs, as in any tab list.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex(({ id }) => id === active);
    let next: number | undefined;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index + TABS.length - 1) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    if (next === undefined) return;

    event.preventDefault();
    const { id } = TABS[next];
    setActive(id);
    tabs.current[id]?.focus();
  };

  return (
    <Card labelledBy="actions-title" className="flex flex-col p-5 sm:p-6 lg:col-start-2 lg:row-span-2 lg:row-start-2">
      <h2 id="actions-title" className="sr-only">
        Stake, unstake and claim
      </h2>

      <div
        role="tablist"
        aria-labelledby="actions-title"
        onKeyDown={onKeyDown}
        className="grid grid-cols-3 gap-1 rounded-md border border-line bg-sunken p-1"
      >
        {TABS.map(({ id, label, icon }) => {
          const selected = id === active;
          return (
            <button
              key={id}
              ref={(element) => {
                tabs.current[id] = element;
              }}
              type="button"
              role="tab"
              id={`tab-${id}`}
              data-testid={`tab-${id}`}
              aria-selected={selected}
              aria-controls={`panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(id)}
              className={cx(
                "flex h-10 items-center justify-center gap-2 rounded-sm text-body font-semibold transition-colors duration-150 ease-standard",
                selected ? "bg-raised text-ink shadow-card" : "text-ink-2 hover:text-ink",
              )}
            >
              {transactions[id].busy ? <Spinner className="h-4 w-4" /> : icon}
              {label}
              {transactions[id].busy && <span className="sr-only">(transaction in progress)</span>}
            </button>
          );
        })}
      </div>

      {TABS.map(({ id }) => {
        const props = { ...panel, tx: transactions[id] };
        return (
          <div
            key={id}
            role="tabpanel"
            id={`panel-${id}`}
            aria-labelledby={`tab-${id}`}
            hidden={id !== active}
            className="mt-4 flex flex-1 flex-col"
          >
            {id === "stake" && <StakePanel {...props} />}
            {id === "unstake" && <UnstakePanel {...props} />}
            {id === "claim" && <ClaimPanel {...props} />}
          </div>
        );
      })}
    </Card>
  );
}

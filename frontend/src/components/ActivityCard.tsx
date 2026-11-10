"use client";

import type { ReactNode } from "react";

import type { ActivityItem, ActivityKind } from "@/lib/activity";
import { formatAge, formatTokenAmount } from "@/lib/format";
import type { PoolSnapshot } from "@/lib/pool";

import { HashChip } from "./HashChip";
import { ActivityIcon, RewardIcon, StakeIcon, UnstakeIcon } from "./icons";
import { Card, cx, Eyebrow, Skeleton } from "./ui";

const KINDS: Record<ActivityKind, { label: string; icon: ReactNode; tint: string }> = {
  staked: {
    label: "Staked",
    icon: <StakeIcon className="h-4 w-4" />,
    tint: "border-accent-line bg-accent-soft text-accent-ink",
  },
  unstaked: {
    label: "Unstaked",
    icon: <UnstakeIcon className="h-4 w-4" />,
    tint: "border-line-strong bg-sunken text-ink-2",
  },
  claimed: {
    label: "Claimed",
    icon: <RewardIcon className="h-4 w-4" />,
    tint: "border-success-line bg-success-soft text-success",
  },
};

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div data-testid="activity-empty" className="flex flex-1 flex-col items-center justify-center px-4 py-3 text-center">
      <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-sunken text-ink-3">
        <ActivityIcon className="h-[1.125rem] w-[1.125rem]" />
      </span>
      <p className="mt-2.5 text-body font-semibold text-ink">{title}</p>
      <p className="mt-0.5 max-w-sm text-caption text-ink-3">{children}</p>
    </div>
  );
}

type ActivityCardProps = {
  snapshot: PoolSnapshot;
  connected: boolean;
  /** Undefined while the first read is in flight. */
  items: ActivityItem[] | undefined;
  failed: boolean;
  /** Chain time in seconds, for "5m ago". */
  nowSeconds: number;
};

/**
 * What the connected account did in this pool, newest first, read from the contract's
 * `Staked`, `Unstaked` and `RewardPaid` events. Nothing is stored by the page itself.
 */
export function ActivityCard({ snapshot, connected, items, failed, nowSeconds }: ActivityCardProps) {
  const { stakingToken, rewardsToken } = snapshot;

  let body: ReactNode;
  if (!connected) {
    body = <Empty title="No wallet connected">Connect a wallet to see its stakes, unstakes and claims in this pool.</Empty>;
  } else if (items === undefined) {
    body = failed ? (
      <Empty title="Activity could not be loaded">The node did not return the pool&apos;s events. Retrying automatically.</Empty>
    ) : (
      <div className="mt-4 space-y-3" aria-hidden="true">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <Empty title="No activity yet">
        Stakes, unstakes and claims made by this wallet will be listed here as soon as they are confirmed.
      </Empty>
    );
  } else {
    body = (
      <ol data-testid="activity-list" className="mt-2 divide-y divide-line">
        {items.map((item) => {
          const kind = KINDS[item.kind];
          const token = item.kind === "claimed" ? rewardsToken : stakingToken;
          return (
            <li
              key={`${item.transactionHash}:${item.logIndex}`}
              data-testid="activity-item"
              data-kind={item.kind}
              className="flex items-center gap-3 py-1.5"
            >
              <span aria-hidden="true" className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full border", kind.tint)}>
                {kind.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body text-ink">
                  <span className="font-semibold">{kind.label}</span>{" "}
                  <span data-testid="activity-amount">{formatTokenAmount(item.amount, token.decimals)}</span>{" "}
                  <span className="text-ink-2">{token.symbol}</span>
                </p>
                <p className="text-caption text-ink-3">
                  Block {item.blockNumber.toString()}
                  {item.timestamp !== undefined && <> · {formatAge(nowSeconds - Number(item.timestamp))}</>}
                </p>
              </div>
              <HashChip value={item.transactionHash} kind="tx" lead={6} tail={4} shorterOnPhones />
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <Card labelledBy="activity-title" className="flex flex-col p-5 sm:p-6 lg:col-start-1 lg:row-start-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Eyebrow id="activity-title">Recent activity</Eyebrow>
        <p className="text-caption text-ink-3">from the pool&apos;s events</p>
      </div>
      {body}
    </Card>
  );
}

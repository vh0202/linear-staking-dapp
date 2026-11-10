"use client";

import type { ReactNode } from "react";

import { formatCountdown, formatFraction, formatTokenAmount, formatUtc } from "@/lib/format";
import type { PoolSnapshot } from "@/lib/pool";
import { poolRewardPerDay, rewardPerStakedTokenPerDay, type PeriodProgress } from "@/lib/rewards";

import { HashChip } from "./HashChip";
import { Amount, Card, Eyebrow, ProgressBar } from "./ui";

type StatProps = {
  label: string;
  value: ReactNode;
  unit?: string;
  /** Where the figure comes from, in a few words. */
  hint: string;
};

function Stat({ label, value, unit, hint }: StatProps) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-ink-2">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-title font-semibold text-ink">{value}</span>
        {unit !== undefined && <span className="text-caption font-medium text-ink-3">{unit}</span>}
      </dd>
      <dd className="mt-0.5 text-caption text-ink-3">{hint}</dd>
    </div>
  );
}

type PoolCardProps = {
  staking: `0x${string}`;
  snapshot: PoolSnapshot;
  period: PeriodProgress;
};

/** The pool as a whole: four figures read from the contract, and where the reward period stands. */
export function PoolCard({ staking, snapshot, period }: PoolCardProps) {
  const { stakingToken, rewardsToken } = snapshot;
  const active = period.status === "active";
  const stakingAmount = (value: bigint) => formatTokenAmount(value, stakingToken.decimals, 2);
  const rewardAmount = (value: bigint) => formatTokenAmount(value, rewardsToken.decimals, 2);

  return (
    <Card labelledBy="pool-title" className="@container p-5 sm:p-6 lg:col-start-1 lg:row-start-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Eyebrow id="pool-title">Pool</Eyebrow>
        <p className="flex items-center gap-1.5 text-caption text-ink-3">
          Contract
          <HashChip value={staking} kind="address" lead={6} tail={4} />
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 @2xl:grid-cols-4">
        <Stat
          label="Total staked"
          value={<Amount testId="pool-total-staked" value={snapshot.totalStaked} format={stakingAmount} />}
          unit={stakingToken.symbol}
          hint="by all stakers"
        />
        <Stat
          label="Reward rate"
          value={
            <span data-testid="pool-reward-rate">
              {active ? formatTokenAmount(poolRewardPerDay(snapshot.rewardRate), rewardsToken.decimals, 2, "nearest") : "0"}
            </span>
          }
          unit={`${rewardsToken.symbol} / day`}
          hint={active ? "shared pro rata to stake" : "no reward period is running"}
        />
        <Stat
          label={`Per staked ${stakingToken.symbol}`}
          value={
            <span data-testid="pool-reward-per-token">
              {active
                ? formatTokenAmount(
                    rewardPerStakedTokenPerDay(snapshot.rewardRate, snapshot.totalStaked, stakingToken.decimals),
                    rewardsToken.decimals,
                    4,
                    "nearest",
                  )
                : "0"}
            </span>
          }
          unit={`${rewardsToken.symbol} / day`}
          hint="reward rate ÷ total staked"
        />
        <Stat
          label="Reward reserve"
          value={<Amount testId="pool-reward-reserve" value={snapshot.rewardReserve} format={rewardAmount} />}
          unit={rewardsToken.symbol}
          hint="funded, not yet paid out"
        />
      </dl>

      <div className="mt-4 border-t border-line pt-4">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div>
            <p className="text-caption text-ink-2">Reward period</p>
            <p className="mt-1 flex items-baseline gap-1.5">
              <span data-testid="pool-period-end" className="text-title font-semibold text-ink">
                {period.status === "none" ? "not started" : formatCountdown(period.secondsLeft)}
              </span>
              {active && <span className="text-caption font-medium text-ink-3">remaining</span>}
            </p>
          </div>
          <p data-testid="pool-period-elapsed" className="text-caption text-ink-2">
            {period.status === "none" && "The owner has not funded rewards yet"}
            {period.status === "ended" && "All rewards of this period have been emitted"}
            {active && (period.elapsed === undefined ? "Running" : `${formatFraction(period.elapsed)} elapsed`)}
          </p>
        </div>

        <ProgressBar fraction={period.elapsed} className="mt-3" />

        <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-0.5 text-caption text-ink-3">
          {period.status === "none" ? (
            <span>Staked tokens start earning as soon as a period is funded.</span>
          ) : (
            <>
              <span>{period.start === undefined ? "Start not found in recent events" : `Started ${formatUtc(period.start)}`}</span>
              <span>
                {period.status === "ended" ? "Ended" : "Ends"} {formatUtc(snapshot.periodFinish)}
              </span>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

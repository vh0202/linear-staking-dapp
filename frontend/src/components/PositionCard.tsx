"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";

import { useLiveRewards } from "@/hooks/useLive";
import {
  formatFraction,
  formatPercent,
  formatTokenAmount,
  formatTokenAmountFixed,
  splitDecimal,
  tickerFractionDigits,
} from "@/lib/format";
import type { AccountSnapshot, PoolSnapshot } from "@/lib/pool";
import { accountRewardPerDay, poolShareBps } from "@/lib/rewards";

import { ClockIcon, TrendUpIcon, WalletIcon } from "./icons";
import { Amount, Card, cx, Eyebrow, LiveDot, Pill, ProgressRing, TokenIcon } from "./ui";

// The two focal figures: the display size on a wide card, scaling down with the card's own
// width to the headline size, so a long number never pushes the layout apart.
const FIGURE =
  "text-[length:clamp(var(--text-headline),4.4cqi,var(--text-display))] font-semibold " +
  "leading-(--text-display--line-height) tracking-(--text-display--letter-spacing) text-ink";
const ZONE_LABEL = "text-caption font-medium text-ink-2";

/** The claimable rewards, ticking. The decimals are set lighter so the eye rests on the whole part. */
export function LiveRewards({ decimals, testId, className }: { decimals: number; testId?: string; className?: string }) {
  const value = useLiveRewards();
  const [whole, fraction] = splitDecimal(
    formatTokenAmountFixed(value, decimals, tickerFractionDigits(value, decimals)),
  );
  return (
    <span data-testid={testId} className={className}>
      {whole}
      <span className="text-ink-2">{fraction}</span>
    </span>
  );
}

/** Shown instead of the figures while no wallet is connected. */
function ConnectPrompt() {
  const { openConnectModal } = useConnectModal();
  return (
    <div data-testid="connect-prompt" className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-5">
      <span
        aria-hidden="true"
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-accent-line bg-accent-soft text-accent-ink"
      >
        <WalletIcon className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1 basis-72">
        <p className="text-title font-semibold text-ink">Connect a wallet to see your position</p>
        <p className="mt-1 max-w-xl text-body text-ink-2">
          Your stake, your share of the pool and your rewards as they accrue will appear here. The pool figures below are
          live already, no wallet needed.
        </p>
      </div>
      <button
        type="button"
        data-testid="connect-prompt-button"
        onClick={openConnectModal}
        disabled={openConnectModal === undefined}
        className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-md bg-cta px-6 text-lead font-semibold text-on-accent shadow-cta transition-[filter,transform] duration-150 ease-standard hover:brightness-110 active:scale-[0.985]"
      >
        <WalletIcon className="h-4 w-4" />
        Connect wallet
      </button>
    </div>
  );
}

type PositionCardProps = {
  snapshot: PoolSnapshot;
  account: AccountSnapshot | undefined;
  /** True while the reward period is running. */
  periodActive: boolean;
};

/**
 * The focal point of the page: what the connected account has staked, what share of the
 * pool that is, and the rewards it can claim, ticking as they accrue.
 */
export function PositionCard({ snapshot, account, periodActive }: PositionCardProps) {
  const { stakingToken, rewardsToken } = snapshot;

  if (account === undefined) {
    return (
      <Card labelledBy="position-title" accent className="relative overflow-hidden lg:col-span-2">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-aura-card" />
        <div aria-hidden="true" className="edge-glow pointer-events-none absolute inset-x-0 top-0 h-px" />
        <div className="relative px-5 py-5 sm:px-7 sm:py-6">
          <Eyebrow id="position-title" strong>
            Your position
          </Eyebrow>
          <ConnectPrompt />
        </div>
      </Card>
    );
  }

  const shareBps = poolShareBps(account.staked, snapshot.totalStaked);
  const perDay = periodActive ? accountRewardPerDay(account.staked, snapshot.totalStaked, snapshot.rewardRate) : 0n;
  const earning = perDay > 0n;
  const stakingAmount = (value: bigint) => formatTokenAmount(value, stakingToken.decimals);
  const rewardAmount = (value: bigint) => formatTokenAmount(value, rewardsToken.decimals);

  return (
    <Card labelledBy="position-title" accent className="@container relative overflow-hidden lg:col-span-2">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-aura-card" />
      <div aria-hidden="true" className="edge-glow pointer-events-none absolute inset-x-0 top-0 h-px" />
      <div className="relative px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-3">
          <Eyebrow id="position-title" strong>
            Your position
          </Eyebrow>
          {earning ? (
            <Pill tone="success" testId="position-status">
              <LiveDot />
              Earning rewards
            </Pill>
          ) : account.staked > 0n ? (
            <Pill tone="warning" testId="position-status">
              <ClockIcon className="h-3.5 w-3.5" />
              Staked, no reward period running
            </Pill>
          ) : (
            <Pill testId="position-status">Nothing staked yet</Pill>
          )}
        </div>

        <div className="mt-4 grid gap-6 @3xl:grid-cols-[1fr_1.15fr_0.8fr] @3xl:gap-0">
          {/* Staked, with the share of the pool as a ring. */}
          <div className="flex items-center gap-5 @3xl:pr-8">
            <ProgressRing fraction={shareBps / 10_000} size={92} stroke={9}>
              <span className="text-caption font-semibold text-ink">{formatFraction(shareBps / 10_000)}</span>
              <span className="text-micro text-ink-2">of pool</span>
            </ProgressRing>
            <div className="min-w-0">
              <p className={ZONE_LABEL}>Staked</p>
              <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
                <Amount testId="staked-balance" value={account.staked} format={stakingAmount} className={FIGURE} />
                <span className="text-lead font-semibold text-ink-2">{stakingToken.symbol}</span>
              </p>
              <p className="mt-2 text-caption text-ink-2">
                <span data-testid="pool-share" className="font-semibold text-ink">
                  {formatPercent(shareBps)}
                </span>{" "}
                of the pool
              </p>
            </div>
          </div>

          {/* Rewards, live. */}
          <div className="border-t border-line pt-6 @3xl:border-l @3xl:border-t-0 @3xl:px-8 @3xl:pt-0">
            <p className={cx(ZONE_LABEL, "flex items-center gap-2")}>
              Claimable rewards
              {earning && (
                <span className="inline-flex items-center gap-1.5 text-micro font-semibold uppercase text-success">
                  <LiveDot />
                  Live
                </span>
              )}
            </p>
            <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
              <LiveRewards testId="pending-rewards" decimals={rewardsToken.decimals} className={FIGURE} />
              <span className="text-lead font-semibold text-ink-2">{rewardsToken.symbol}</span>
            </p>
            <p data-testid="reward-pace" className={cx("mt-2 flex items-center gap-1.5 text-caption", earning ? "text-success" : "text-ink-2")}>
              {earning ? (
                <>
                  <TrendUpIcon className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    +{formatTokenAmount(perDay, rewardsToken.decimals, 2, "nearest")} {rewardsToken.symbol} per day at your
                    current share
                  </span>
                </>
              ) : account.staked === 0n ? (
                periodActive ? (
                  `Stake ${stakingToken.symbol} to start earning`
                ) : (
                  "No reward period is running"
                )
              ) : (
                "No reward period is running: nothing is accruing"
              )}
            </p>
          </div>

          {/* What is still in the wallet. */}
          <div className="border-t border-line pt-6 @3xl:border-l @3xl:border-t-0 @3xl:pl-8 @3xl:pt-0">
            <p className={ZONE_LABEL}>In your wallet</p>
            <dl className="mt-2.5 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-body text-ink-2">
                  <TokenIcon symbol={stakingToken.symbol} tint={0} />
                  {stakingToken.symbol}
                </dt>
                <dd className="text-lead font-semibold text-ink">
                  <Amount testId="wallet-balance" value={account.walletBalance} format={stakingAmount} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-body text-ink-2">
                  <TokenIcon symbol={rewardsToken.symbol} tint={1} />
                  {rewardsToken.symbol}
                </dt>
                <dd className="text-lead font-semibold text-ink">
                  <Amount testId="wallet-reward-balance" value={account.rewardWalletBalance} format={rewardAmount} />
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </Card>
  );
}

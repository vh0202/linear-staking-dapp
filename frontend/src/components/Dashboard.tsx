"use client";

import { useCallback, useLayoutEffect, type ReactNode } from "react";
import { BaseError, ContractFunctionZeroDataError } from "viem";
import { useAccount, useSwitchChain } from "wagmi";

import { isLocalChain } from "@/config/chains";
import { appConfig } from "@/config/env";
import { chain } from "@/config/wagmi";
import { useActivity } from "@/hooks/useActivity";
import { useClock } from "@/hooks/useClock";
import { usePool } from "@/hooks/usePool";
import { chainElapsedMs } from "@/lib/chainClock";
import { formatUtc, shortenAddress } from "@/lib/format";
import { liveRewards } from "@/lib/liveRewards";
import { periodProgress } from "@/lib/rewards";

import { ActionPanel, type Gate } from "./ActionPanel";
import { ActivityCard } from "./ActivityCard";
import { FooterStatus } from "./Footer";
import { DASHBOARD_GRID, DashboardSkeleton, PageFrame } from "./Frame";
import { HeaderControls, HeaderStatus, type NetworkStatus } from "./Header";
import { ErrorIcon, Spinner } from "./icons";
import { PoolCard } from "./PoolCard";
import { PositionCard } from "./PositionCard";
import { Toaster } from "./Toaster";
import { Code, Notice, quietButtonClass } from "./ui";

const local = isLocalChain(chain.id);

/**
 * Shown instead of the dashboard when there is nothing to show: what is wrong, and the
 * commands or settings that fix it.
 */
function Problem({
  title,
  children,
  testId,
  retrying = false,
}: {
  title: string;
  children: ReactNode;
  testId: string;
  /** The page keeps trying by itself and says so. */
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="mx-auto mt-2 max-w-2xl rounded-xl border border-line bg-surface bg-sheen p-6 shadow-card sm:mt-12 sm:p-8"
    >
      <span
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-lg border border-danger-line bg-danger-soft text-danger"
      >
        <ErrorIcon className="h-6 w-6" />
      </span>
      <h2 className="mt-5 text-title font-semibold text-ink">{title}</h2>
      <div className="mt-2 space-y-2 text-body leading-6 text-ink-2">{children}</div>
      {retrying && (
        <p className="mt-6 flex items-center gap-2.5 border-t border-line pt-4 text-caption text-ink-3">
          <Spinner className="h-3.5 w-3.5 shrink-0" />
          Trying again every few seconds. The page continues by itself as soon as the node answers.
        </p>
      )}
    </div>
  );
}

function ConfigProblems() {
  return (
    <Problem title="The front end is not configured" testId="config-problems">
      <ul className="list-inside list-disc">
        {appConfig.problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
      <p>
        {local ? (
          <>
            For the local demo run <Code>npx hardhat node</Code> and <Code>npm run deploy:local</Code> in the repository
            root; the second command writes <Code>frontend/.env.local</Code>. Then restart the front end.
          </>
        ) : (
          <>
            Set the variables listed in <Code>frontend/.env.example</Code> and rebuild.
          </>
        )}
      </p>
    </Problem>
  );
}

function explainLoadError(error: unknown): { title: string; body: ReactNode } {
  const noContract =
    error instanceof BaseError && error.walk((cause) => cause instanceof ContractFunctionZeroDataError) !== null;

  if (noContract) {
    return {
      title: `No staking contract found at ${shortenAddress(appConfig.stakingAddress ?? "")} on ${chain.name}`,
      body: local ? (
        <>
          The local node was probably restarted, which wipes its state. Run <Code>npm run deploy:local</Code> in the
          repository root.
        </>
      ) : (
        <>
          Check <Code>NEXT_PUBLIC_STAKING_ADDRESS</Code> and <Code>NEXT_PUBLIC_CHAIN_ID</Code>.
        </>
      ),
    };
  }
  return {
    title: `Cannot reach ${chain.name}`,
    body: local ? (
      <>
        Start the local node with <Code>npx hardhat node</Code> and deploy the demo with{" "}
        <Code>npm run deploy:local</Code>, both in the repository root.
      </>
    ) : (
      <>
        The RPC endpoint did not answer. Check <Code>NEXT_PUBLIC_RPC_URL</Code> or try again later.
      </>
    ),
  };
}

export function Dashboard() {
  const { address, isConnected, chainId: walletChainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const pool = usePool();
  const activity = useActivity();
  const nowMs = useClock();

  const staking = appConfig.stakingAddress;
  const snapshot = pool.data;
  // While the query re-keys after connecting, the previous snapshot may still describe
  // another account (or none): only use the part that belongs to the connected address.
  const account = snapshot?.account !== undefined && snapshot.account.address === address ? snapshot.account : undefined;

  const wrongNetwork = isConnected && walletChainId !== chain.id;
  const gate: Gate = !isConnected ? "disconnected" : wrongNetwork ? "wrong-network" : undefined;
  const network: NetworkStatus = wrongNetwork
    ? "wrong-network"
    : pool.failing
      ? "offline"
      : snapshot === undefined
        ? "idle"
        : "live";

  // Every new snapshot goes to the rewards ticker, which reconciles what is on screen with
  // it before the browser paints (see lib/liveRewards.ts).
  useLayoutEffect(() => {
    liveRewards.setInputs(
      snapshot === undefined || account === undefined
        ? undefined
        : {
            account: account.address,
            earned: account.earned,
            staked: account.staked,
            totalStaked: snapshot.totalStaked,
            rewardRate: snapshot.rewardRate,
            periodFinish: snapshot.periodFinish,
            blockTimestamp: snapshot.blockTimestamp,
            clockOffsetMs: snapshot.clockOffsetMs,
          },
    );
  }, [snapshot, account]);

  // Awaited after a receipt and before "confirmed" is shown: balances and the activity list
  // are already up to date when the page says so.
  const { refetch: refetchPool } = pool;
  const { refetch: refetchActivity } = activity;
  const refresh = useCallback(() => Promise.all([refetchPool(), refetchActivity()]), [refetchPool, refetchActivity]);

  let content: ReactNode;
  if (staking === undefined) {
    content = <ConfigProblems />;
  } else if (snapshot === undefined) {
    if (pool.failing) {
      const { title, body } = explainLoadError(pool.failure);
      content = (
        <Problem title={title} testId="load-error" retrying>
          <p>{body}</p>
        </Problem>
      );
    } else {
      content = <DashboardSkeleton label="Reading the chain..." />;
    }
  } else {
    // Chain time: the local clock plus the estimated offset of the chain's clock. It drives
    // the countdown, the period progress and the ages in the activity list.
    const chainSeconds =
      Number(snapshot.blockTimestamp) +
      (nowMs === 0 ? 0 : chainElapsedMs(snapshot.blockTimestamp, snapshot.clockOffsetMs, nowMs) / 1000);
    const period = periodProgress(snapshot.periodFinish, snapshot.periodDuration, chainSeconds);
    const periodActive = period.status === "active";

    content = (
      <>
        <div className="mb-5 space-y-3 empty:hidden">
          {pool.failing && (
            <Notice tone="warning" title="Connection problem: showing the last values that were read" testId="stale-data">
              <p>The node did not answer the last request. Retrying automatically; nothing can be sent until it does.</p>
            </Notice>
          )}
          {wrongNetwork && (
            <Notice
              tone="warning"
              title="Your wallet is on a different network"
              testId="wrong-network"
              action={
                <button
                  type="button"
                  className={quietButtonClass}
                  disabled={switching}
                  onClick={() => switchChain({ chainId: chain.id })}
                >
                  Switch to {chain.name}
                </button>
              }
            >
              <p>
                This page reads and writes {chain.name}. The figures below are live, but staking, unstaking and claiming
                stay disabled until the wallet is on the same network.
              </p>
            </Notice>
          )}
          {snapshot.paused && (
            <Notice tone="warning" title="The pool is paused by its owner" testId="paused-notice">
              <p>
                Staking and claiming are disabled for now. Your stake is safe to withdraw: unstaking always works, and
                rewards keep accruing and stay claimable once the pool is unpaused.
              </p>
            </Notice>
          )}
          {period.status === "ended" && (
            <Notice tone="info" title="The reward period has ended" testId="period-ended">
              <p>
                No rewards have been accruing since {formatUtc(snapshot.periodFinish)}. Everything earned until then can
                still be claimed, and stakes can be withdrawn. Rewards resume when the owner funds a new period.
              </p>
            </Notice>
          )}
          {period.status === "none" && (
            <Notice tone="info" title="No reward period has been funded yet" testId="period-none">
              <p>You can stake already. Rewards start the moment the owner funds a period.</p>
            </Notice>
          )}
        </div>

        <div className={DASHBOARD_GRID}>
          <PositionCard snapshot={snapshot} account={account} periodActive={periodActive} />
          <ActionPanel
            staking={staking}
            snapshot={snapshot}
            account={account}
            gate={gate}
            periodActive={periodActive}
            refresh={refresh}
          />
          <PoolCard staking={staking} snapshot={snapshot} period={period} />
          <ActivityCard
            snapshot={snapshot}
            connected={account !== undefined}
            items={account === undefined ? undefined : activity.data}
            failed={activity.isError}
            nowSeconds={chainSeconds}
          />
        </div>
      </>
    );
  }

  return (
    <PageFrame
      headerEnd={<HeaderControls />}
      headerStatus={<HeaderStatus network={network} />}
      footerEnd={<FooterStatus blockNumber={snapshot?.blockNumber} stale={pool.failing} />}
    >
      {content}
      <Toaster />
    </PageFrame>
  );
}

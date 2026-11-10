import type { ReactNode } from "react";

import { APP_NAME, HONESTY_LABEL } from "@/config/site";

import { Logo } from "./icons";
import { Card, cx, Skeleton } from "./ui";

// The page frame and its loading state. No wallet code is imported here: the server renders
// this, and it is what a visitor sees until the app has loaded.

/** Width and gutters shared by the header, the content and the footer. */
export const PAGE_WIDTH = "mx-auto w-full max-w-[75rem] px-4 sm:px-6";

/** The grid of the dashboard: the position across the top, then information and actions. */
export const DASHBOARD_GRID =
  "grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_25.5rem] lg:grid-rows-[auto_auto_1fr]";

export function Brand() {
  return (
    <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
      <Logo className="h-8 w-8 shrink-0 sm:h-9 sm:w-9" />
      <div className="min-w-0">
        <h1 className="truncate text-lead font-semibold leading-5 text-ink">{APP_NAME}</h1>
        <p className="hidden text-caption leading-4 text-ink-3 sm:block">ERC-20 staking with linear rewards</p>
      </div>
    </div>
  );
}

type PageFrameProps = {
  /** Right end of the header: theme, wallet. */
  headerEnd?: ReactNode;
  /** Status pills. Next to the controls on a wide screen, on a row of their own below. */
  headerStatus?: ReactNode;
  /** Right side of the footer bar. */
  footerEnd?: ReactNode;
  children: ReactNode;
};

export function PageFrame({ headerEnd, headerStatus, footerEnd, children }: PageFrameProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className={cx(PAGE_WIDTH, "flex min-h-16 flex-wrap items-center gap-x-3")}>
          <Brand />
          {headerStatus !== undefined && (
            <div className="order-last flex basis-full flex-wrap items-center gap-2 pb-3 lg:order-none lg:ml-auto lg:basis-auto lg:pb-0">
              {headerStatus}
            </div>
          )}
          <div className={cx("ml-auto flex h-16 items-center gap-2", headerStatus !== undefined && "lg:ml-0")}>
            {headerEnd}
          </div>
        </div>
      </header>

      <main className={cx(PAGE_WIDTH, "flex-1 py-4 sm:py-5")}>{children}</main>

      {/* The label that says what this project is. From tablet width up it stays on screen
          while the page scrolls; on a phone it would cover too much, so it ends the page. */}
      <footer className="bottom-0 z-20 border-t border-line bg-bg sm:sticky">
        <div
          className={cx(
            PAGE_WIDTH,
            "flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2.5 text-caption text-ink-2",
          )}
        >
          <p data-testid="honesty-label">{HONESTY_LABEL}</p>
          {footerEnd}
        </div>
      </footer>
    </div>
  );
}

function SkeletonFigure() {
  return (
    <div>
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="mt-3 h-10 w-48 max-w-full" />
      <Skeleton className="mt-3 h-3.5 w-36" />
    </div>
  );
}

/** The dashboard's shape while nothing has been read yet. Same boxes, so nothing jumps. */
export function DashboardSkeleton({ label }: { label: string }) {
  return (
    <div data-testid="loading" role="status" aria-busy="true" className={DASHBOARD_GRID}>
      <Card className="px-5 py-5 sm:px-7 sm:py-6 lg:col-span-2">
        <Skeleton className="h-3 w-28" />
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          <SkeletonFigure />
          <SkeletonFigure />
          <SkeletonFigure />
        </div>
      </Card>

      <Card className="p-5 sm:p-6 lg:col-start-2 lg:row-span-2 lg:row-start-2">
        <Skeleton className="h-11 w-full rounded-md" />
        <Skeleton className="mt-6 h-3.5 w-20" />
        <Skeleton className="mt-3 h-16 w-full rounded-lg" />
        <Skeleton className="mt-6 h-10 w-full" />
        <Skeleton className="mt-6 h-16 w-full" />
        <Skeleton className="mt-6 h-12 w-full rounded-md" />
      </Card>

      <Card className="p-5 sm:p-6 lg:col-start-1 lg:row-start-2">
        <Skeleton className="h-3 w-16" />
        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index}>
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="mt-2.5 h-6 w-24" />
              <Skeleton className="mt-2.5 h-3 w-28 max-w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-7 h-2 w-full rounded-full" />
      </Card>

      <Card className="p-5 sm:p-6 lg:col-start-1 lg:row-start-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-5 h-10 w-full" />
        <Skeleton className="mt-3 h-10 w-full" />
      </Card>

      <span className="sr-only">{label}</span>
    </div>
  );
}

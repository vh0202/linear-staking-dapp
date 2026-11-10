"use client";

import { useId, type ReactNode } from "react";

import { useTween } from "@/hooks/useLive";

import { AlertIcon, ErrorIcon, InfoIcon } from "./icons";

// Presentational building blocks. Nothing in this file touches the wallet stack, so the
// static shell that is rendered on the server can use it too.

/** Joins class names, skipping the falsy ones. */
export const cx = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(" ");

// ------------------------------------------------------------------ buttons

const buttonBase =
  "inline-flex items-center justify-center gap-2 font-semibold " +
  "transition-[filter,background-color,border-color,color,transform] duration-150 ease-standard " +
  "enabled:active:scale-[0.985] disabled:cursor-not-allowed";

/**
 * The one call to action of a form. A disabled button keeps a readable label, because that
 * label is where the page says why it cannot be pressed.
 */
export const primaryButtonClass = cx(
  buttonBase,
  "h-12 w-full rounded-md bg-cta px-5 text-lead text-on-accent shadow-cta enabled:hover:brightness-110",
  "disabled:bg-line disabled:bg-none disabled:text-ink-2 disabled:shadow-none",
);

export const secondaryButtonClass = cx(
  buttonBase,
  "h-11 rounded-md border border-line-strong bg-transparent px-5 text-body text-ink",
  "enabled:hover:border-ink-3 enabled:hover:bg-raised",
  "disabled:border-line disabled:text-ink-3",
);

export const quietButtonClass = cx(
  buttonBase,
  "h-8 rounded-sm border border-line-strong bg-surface px-3 text-caption text-ink enabled:hover:bg-raised",
);

// ------------------------------------------------------------------ layout

export function Card({
  children,
  className,
  labelledBy,
  testId,
  accent = false,
}: {
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  testId?: string;
  /** The one card the eye should land on first gets an accent-tinted edge. */
  accent?: boolean;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      data-testid={testId}
      className={cx(
        "rounded-xl border bg-surface bg-sheen shadow-card",
        accent ? "border-accent-line" : "border-line",
        className,
      )}
    >
      {children}
    </section>
  );
}

/**
 * Small uppercase heading of a card. `strong` is for the position card, whose tinted
 * background is too colourful for the quietest text colour.
 */
export function Eyebrow({ id, children, strong = false }: { id?: string; children: ReactNode; strong?: boolean }) {
  return (
    <h2 id={id} className={cx("text-micro font-semibold uppercase", strong ? "text-ink-2" : "text-ink-3")}>
      {children}
    </h2>
  );
}

/** Placeholder with the size of the thing that is loading. */
export function Skeleton({ className }: { className: string }) {
  return <span aria-hidden="true" className={cx("skeleton block", className)} />;
}

// ------------------------------------------------------------------ numbers

/**
 * A token amount that counts to each new value. While it is counting it carries
 * `data-animating`, so a test (or a screenshot) can wait for the final figure.
 */
export function Amount({
  value,
  format,
  testId,
  className,
}: {
  value: bigint;
  format: (value: bigint) => string;
  testId?: string;
  className?: string;
}) {
  const shown = useTween(value);
  return (
    <span data-testid={testId} data-animating={shown === value ? undefined : ""} className={className}>
      {format(shown)}
    </span>
  );
}

const TOKEN_TINTS = ["bg-accent-soft text-accent-ink border-accent-line", "bg-success-soft text-success border-success-line"];

/** Monogram badge for a token. The mock tokens have no logo, so none is invented. */
export function TokenIcon({ symbol, tint, className = "h-5 w-5" }: { symbol: string; tint: 0 | 1; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full border text-micro font-bold leading-none tracking-normal",
        TOKEN_TINTS[tint],
        className,
      )}
    >
      {symbol.slice(0, 1).toUpperCase()}
    </span>
  );
}

// ------------------------------------------------------------------ graphics

/** A ring that fills clockwise from the top. Decorative: the figure is always printed too. */
export function ProgressRing({
  fraction,
  size,
  stroke = 8,
  children,
}: {
  /** 0..1. */
  fraction: number;
  /** Diameter in px. */
  size: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const gradient = useId();
  const radius = (size - stroke) / 2;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  // A share that is not zero must not look like zero: always show at least a dot.
  const visible = clamped > 0 ? Math.max(clamped, 0.012) : 0;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false" className="-rotate-90">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--grad-to)" />
            <stop offset="0.5" stopColor="var(--grad-via)" />
            <stop offset="1" stopColor="var(--grad-from)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {visible > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={`url(#${gradient})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={`${visible} 1`}
            className="glow-graphic transition-[stroke-dasharray] duration-250 ease-standard"
          />
        )}
      </svg>
      {children !== undefined && (
        // A disc of the card's own colour inside the ring: the label has a plain background.
        <div
          className="absolute flex flex-col items-center justify-center rounded-full bg-surface"
          style={{ inset: stroke + 1 }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** A horizontal track that fills from the left. Decorative, like the ring. */
export function ProgressBar({ fraction, className }: { fraction: number | undefined; className?: string }) {
  const clamped = fraction === undefined ? 0 : Math.min(1, Math.max(0, fraction));
  return (
    <div aria-hidden="true" className={cx("h-2 overflow-hidden rounded-full bg-line", className)}>
      <div
        className="h-full min-w-2 rounded-full bg-signature transition-[width] duration-250 ease-standard"
        style={{ width: `${clamped * 100}%`, visibility: clamped > 0 ? "visible" : "hidden" }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ status

export type Tone = "accent" | "success" | "warning" | "danger" | "neutral";

const PILL_TONES: Record<Tone, string> = {
  accent: "border-accent-line bg-accent-soft text-accent-ink",
  success: "border-success-line bg-success-soft text-success",
  warning: "border-warning-line bg-warning-soft text-warning",
  danger: "border-danger-line bg-danger-soft text-danger",
  neutral: "border-line bg-surface text-ink-2",
};

export function Pill({
  tone = "neutral",
  children,
  title,
  testId,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
  testId?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      data-testid={testId}
      className={cx(
        "inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-caption font-medium",
        PILL_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A dot that pulses while something is live. The label next to it carries the meaning. */
export function LiveDot({ tone = "success", live = true }: { tone?: "success" | "warning" | "neutral"; live?: boolean }) {
  const color = tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-ink-3";
  return (
    <span aria-hidden="true" className="relative inline-flex h-2 w-2 shrink-0">
      {live && <span className={cx("absolute inset-0 rounded-full animate-live", color)} />}
      <span className={cx("relative h-2 w-2 rounded-full", color)} />
    </span>
  );
}

type NoticeProps = {
  tone: "info" | "warning" | "error";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  testId?: string;
};

const NOTICE_TONES: Record<NoticeProps["tone"], { box: string; icon: ReactNode }> = {
  info: {
    box: "border-accent-line bg-accent-soft",
    icon: <InfoIcon className="h-5 w-5 text-accent-ink" />,
  },
  warning: {
    box: "border-warning-line bg-warning-soft",
    icon: <AlertIcon className="h-5 w-5 text-warning" />,
  },
  error: {
    box: "border-danger-line bg-danger-soft",
    icon: <ErrorIcon className="h-5 w-5 text-danger" />,
  },
};

/** A page-level message: what is wrong, what it means for the user, and what to do. */
export function Notice({ tone, title, children, action, testId }: NoticeProps) {
  const { box, icon } = NOTICE_TONES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      data-testid={testId}
      className={cx("flex flex-wrap items-start gap-x-4 gap-y-3 rounded-lg border px-4 py-3.5 sm:px-5", box)}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-body font-semibold text-ink">{title}</p>
        {children !== undefined && <div className="mt-1 space-y-1 text-body text-ink-2">{children}</div>}
      </div>
      {action}
    </div>
  );
}

/** Inline code, for commands in help messages. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-xs border border-line bg-sunken px-1.5 py-0.5 font-mono text-caption text-ink">{children}</code>
  );
}

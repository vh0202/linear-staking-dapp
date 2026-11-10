import { formatUnits } from "viem";

const groupThousands = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * Formats a token amount for display: thousands separators, at most `maxFractionDigits`
 * decimals, trailing zeros removed.
 *
 * By default the value is truncated, never rounded up, so the UI can never show more than
 * an account really has. A non-zero amount too small to show is rendered as "<0.0001"
 * rather than "0". Pass `rounding: "nearest"` for figures that are estimates anyway
 * (rates per day), where 9,999.99999 should read as 10,000.
 */
export function formatTokenAmount(
  value: bigint,
  decimals: number,
  maxFractionDigits = 4,
  rounding: "down" | "nearest" = "down",
): string {
  if (value < 0n) return `-${formatTokenAmount(-value, decimals, maxFractionDigits, rounding)}`;

  if (rounding === "nearest" && decimals > maxFractionDigits) {
    const unit = 10n ** BigInt(decimals - maxFractionDigits);
    value = ((value + unit / 2n) / unit) * unit;
  }

  const [whole, fraction = ""] = formatUnits(value, decimals).split(".");
  const shown = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");

  if (value > 0n && whole === "0" && shown === "") {
    return maxFractionDigits === 0 ? "<1" : `<0.${"0".repeat(maxFractionDigits - 1)}1`;
  }
  return shown === "" ? groupThousands(whole) : `${groupThousands(whole)}.${shown}`;
}

/**
 * Like `formatTokenAmount` but always with exactly `fractionDigits` decimals. Used for the
 * live rewards ticker, where a fixed width keeps the number from jumping around.
 */
export function formatTokenAmountFixed(value: bigint, decimals: number, fractionDigits: number): string {
  const [whole, fraction = ""] = formatUnits(value < 0n ? -value : value, decimals).split(".");
  const sign = value < 0n ? "-" : "";
  if (fractionDigits === 0) return `${sign}${groupThousands(whole)}`;
  return `${sign}${groupThousands(whole)}.${fraction.slice(0, fractionDigits).padEnd(fractionDigits, "0")}`;
}

/**
 * How many decimals the live rewards ticker shows: six while the amount is small, fewer once
 * the whole part gets long, so the figure keeps roughly the same width. Never more than the
 * token has.
 */
export function tickerFractionDigits(value: bigint, decimals: number): number {
  const whole = (value < 0n ? -value : value) / 10n ** BigInt(decimals);
  const most = Math.min(decimals, 6);
  if (whole >= 1_000_000n) return Math.min(most, 2);
  if (whole >= 10_000n) return Math.min(most, 4);
  return most;
}

/**
 * Splits a formatted number at the decimal point, so the two parts can be set in different
 * weights: "1,234.567891" -> ["1,234", ".567891"], "42" -> ["42", ""].
 */
export function splitDecimal(formatted: string): [whole: string, fraction: string] {
  const dot = formatted.indexOf(".");
  return dot === -1 ? [formatted, ""] : [formatted.slice(0, dot), formatted.slice(dot)];
}

/** "6d 23h 12m", "4h 05m 09s", "59s"; "ended" for zero or negative durations. */
export function formatCountdown(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "ended";

  const seconds = Math.floor(totalSeconds);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(rest)}s`;
  if (minutes > 0) return `${minutes}m ${pad(rest)}s`;
  return `${rest}s`;
}

/**
 * How long ago something happened, in its largest unit: "just now", "42s ago", "5m ago",
 * "6h ago", "3d ago". Anything in the future (clock skew) reads as "just now".
 */
export function formatAge(secondsAgo: number): string {
  if (!Number.isFinite(secondsAgo) || secondsAgo < 5) return "just now";

  const seconds = Math.floor(secondsAgo);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

/** Unix seconds as "2026-11-17 14:03 UTC". Fixed format and time zone, independent of locale. */
export function formatUtc(timestampSeconds: bigint | number): string {
  const date = new Date(Number(timestampSeconds) * 1000);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Basis points as a percentage with two decimals: 2000 -> "20.00%". */
export function formatPercent(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`;
}

/**
 * A fraction between 0 and 1 as a short percentage for a gauge: 0.2 -> "20%", 0.037 ->
 * "3.7%". Rounded down, and never "0%" or "100%" unless that is exactly true.
 */
export function formatFraction(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction <= 0) return "0%";
  if (fraction >= 1) return "100%";

  // The epsilon undoes binary rounding: 0.29 * 100 is 28.999999999999996, and must read 29%.
  const percent = fraction * 100 + 1e-9;
  if (percent < 0.1) return "<0.1%";
  if (percent > 99.9) return ">99.9%";
  if (percent < 10) return `${(Math.floor(percent * 10) / 10).toFixed(1)}%`;
  return `${Math.floor(percent)}%`;
}

/** "0x7099…79C8". Strings that are already short are returned unchanged. */
export function shortenAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

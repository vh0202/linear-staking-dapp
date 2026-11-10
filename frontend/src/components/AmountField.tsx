import type { ReactNode } from "react";

import { AlertIcon } from "./icons";
import { cx, TokenIcon } from "./ui";

type AmountFieldProps = {
  id: string;
  label: string;
  symbol: string;
  /** Which of the two token badges to show. */
  tint: 0 | 1;
  value: string;
  onChange: (value: string) => void;
  onMax: () => void;
  /** e.g. "Wallet 10,000 STK". */
  available: ReactNode;
  /** Validation message; empty when the input is fine or untouched. */
  error: string;
  disabled: boolean;
};

/** Token amount input with a MAX shortcut and an inline validation message. */
export function AmountField({ id, label, symbol, tint, value, onChange, onMax, available, error, disabled }: AmountFieldProps) {
  const invalid = error !== "";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-caption">
        <label htmlFor={id} className="font-medium text-ink-2">
          {label}
        </label>
        <span className="text-ink-3">{available}</span>
      </div>

      <div
        className={cx(
          "mt-2 flex h-16 items-center gap-2 rounded-lg border bg-sunken pl-4 pr-3 transition-[border-color,box-shadow] duration-150 ease-standard",
          invalid ? "border-danger" : "border-line focus-within:border-accent focus-within:shadow-glow",
        )}
      >
        <input
          id={id}
          data-testid={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0.0"
          value={value}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={`${id}-message`}
          onChange={(event) => onChange(event.target.value)}
          className="h-full w-full min-w-0 bg-transparent text-headline font-semibold text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed"
        />
        <button
          type="button"
          data-testid={`${id}-max`}
          onClick={onMax}
          disabled={disabled}
          className="h-7 shrink-0 rounded-xs border border-accent-line bg-accent-soft px-2 text-micro font-semibold text-accent-ink transition-colors duration-150 enabled:hover:border-accent disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-ink-3"
        >
          MAX
        </button>
        <span className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface pl-1.5 pr-3 text-body font-semibold text-ink">
          <TokenIcon symbol={symbol} tint={tint} className="h-6 w-6" />
          {symbol}
        </span>
      </div>

      <p
        id={`${id}-message`}
        data-testid={`${id}-message`}
        className="mt-1.5 flex min-h-5 items-center gap-1.5 text-caption text-danger"
      >
        {invalid && <AlertIcon className="h-3.5 w-3.5 shrink-0" />}
        {error}
      </p>
    </div>
  );
}

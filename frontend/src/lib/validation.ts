import { parseUnits } from "viem";

export type AmountValidation =
  | { ok: true; amount: bigint }
  | {
      ok: false;
      reason: "empty" | "invalid" | "too-many-decimals" | "zero" | "exceeds-max";
      /** Shown under the input. Empty for the "nothing typed yet" case. */
      message: string;
    };

// Plain decimal notation only: digits with at most one dot. No sign, no exponent, no
// thousands separators, so there is exactly one way to read what was typed.
const DECIMAL = /^(\d+\.?\d*|\.\d+)$/;

/**
 * Validates a token amount typed by the user.
 *
 * @param input      Raw text from the input field.
 * @param decimals   Decimals of the token.
 * @param max        Largest amount allowed (wallet balance when staking, stake when unstaking).
 * @param maxMessage Message to show when the amount is above `max`.
 */
export function validateAmount(input: string, decimals: number, max: bigint, maxMessage: string): AmountValidation {
  const text = input.trim();
  if (text === "") return { ok: false, reason: "empty", message: "" };

  if (!DECIMAL.test(text)) {
    return { ok: false, reason: "invalid", message: "Enter a number, for example 12.5" };
  }

  const fraction = text.split(".")[1] ?? "";
  if (fraction.length > decimals) {
    return {
      ok: false,
      reason: "too-many-decimals",
      message: decimals === 0 ? "This token has no decimals" : `This token has at most ${decimals} decimals`,
    };
  }

  const amount = parseUnits(text, decimals);
  if (amount === 0n) {
    return { ok: false, reason: "zero", message: "Enter an amount greater than zero" };
  }
  if (amount > max) {
    return { ok: false, reason: "exceeds-max", message: maxMessage };
  }
  return { ok: true, amount };
}

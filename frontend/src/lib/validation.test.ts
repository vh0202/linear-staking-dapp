import { describe, expect, it } from "vitest";

import { validateAmount } from "./validation";

const ONE = 10n ** 18n;
const BALANCE = 100n * ONE;
const TOO_MUCH = "More than your wallet balance";

const check = (input: string, decimals = 18, max = BALANCE) => validateAmount(input, decimals, max, TOO_MUCH);

describe("validateAmount", () => {
  it("accepts plain decimal numbers and returns the amount in wei", () => {
    expect(check("1")).toEqual({ ok: true, amount: ONE });
    expect(check("12.5")).toEqual({ ok: true, amount: 12n * ONE + ONE / 2n });
    expect(check("0.000000000000000001")).toEqual({ ok: true, amount: 1n });
    expect(check(".5")).toEqual({ ok: true, amount: ONE / 2n });
    expect(check("5.")).toEqual({ ok: true, amount: 5n * ONE });
    expect(check("  7  ")).toEqual({ ok: true, amount: 7n * ONE });
    expect(check("007")).toEqual({ ok: true, amount: 7n * ONE });
  });

  it("accepts exactly the maximum", () => {
    expect(check("100")).toEqual({ ok: true, amount: BALANCE });
  });

  it("treats an empty field as not ready, without an error message", () => {
    expect(check("")).toEqual({ ok: false, reason: "empty", message: "" });
    expect(check("   ")).toEqual({ ok: false, reason: "empty", message: "" });
  });

  it("rejects anything that is not a plain decimal number", () => {
    for (const input of ["abc", "-1", "+1", "1e3", "1,000", "1.2.3", ".", "1 000", "0x10", "١٢"]) {
      const result = check(input);
      expect(result.ok, `"${input}" must be rejected`).toBe(false);
      expect(result).toMatchObject({ reason: "invalid" });
    }
  });

  it("rejects more decimals than the token has", () => {
    expect(check("0.0000000000000000001")).toMatchObject({ ok: false, reason: "too-many-decimals" });
    expect(check("1.1234567", 6)).toMatchObject({
      ok: false,
      reason: "too-many-decimals",
      message: "This token has at most 6 decimals",
    });
    expect(check("1.5", 0)).toMatchObject({ reason: "too-many-decimals", message: "This token has no decimals" });
    expect(check("1.123456", 6, 10n ** 9n)).toEqual({ ok: true, amount: 1_123_456n });
  });

  it("rejects zero in every spelling", () => {
    for (const input of ["0", "0.0", "00", ".0", "0.000000000000000000"]) {
      expect(check(input)).toMatchObject({ ok: false, reason: "zero" });
    }
  });

  it("rejects amounts above the maximum with the caller's message", () => {
    expect(check("100.000000000000000001")).toEqual({ ok: false, reason: "exceeds-max", message: TOO_MUCH });
    expect(check("1", 18, 0n)).toMatchObject({ ok: false, reason: "exceeds-max" });
  });

  it("handles amounts far beyond Number.MAX_SAFE_INTEGER exactly", () => {
    const huge = "123456789012345678901234567890.123456789012345678";
    const result = validateAmount(huge, 18, 10n ** 60n, TOO_MUCH);
    expect(result).toEqual({ ok: true, amount: 123456789012345678901234567890123456789012345678n });
  });
});

import { describe, expect, it } from "vitest";

import {
  formatAge,
  formatCountdown,
  formatFraction,
  formatPercent,
  formatTokenAmount,
  formatTokenAmountFixed,
  formatUtc,
  shortenAddress,
  splitDecimal,
  tickerFractionDigits,
} from "./format";

const ONE = 10n ** 18n;

describe("formatTokenAmount", () => {
  it("formats whole amounts with thousands separators", () => {
    expect(formatTokenAmount(0n, 18)).toBe("0");
    expect(formatTokenAmount(ONE, 18)).toBe("1");
    expect(formatTokenAmount(10_000n * ONE, 18)).toBe("10,000");
    expect(formatTokenAmount(1_234_567n * ONE, 18)).toBe("1,234,567");
  });

  it("keeps at most four decimals by default and drops trailing zeros", () => {
    expect(formatTokenAmount(1_500n * ONE + ONE / 2n, 18)).toBe("1,500.5");
    expect(formatTokenAmount(123_456_789_000_000_000n, 18)).toBe("0.1234");
    expect(formatTokenAmount(2n * ONE + 10n ** 14n, 18)).toBe("2.0001");
    expect(formatTokenAmount(2n * ONE + 10n ** 13n, 18)).toBe("2");
  });

  it("truncates instead of rounding up, so it never shows more than there is", () => {
    expect(formatTokenAmount(999_999_999_999_999_999n, 18)).toBe("0.9999");
    expect(formatTokenAmount(1_999_990_000_000_000_000n, 18, 2)).toBe("1.99");
  });

  it("shows a non-zero amount that is too small as a lower bound, not as zero", () => {
    expect(formatTokenAmount(1n, 18)).toBe("<0.0001");
    expect(formatTokenAmount(99_999_999_999_999n, 18)).toBe("<0.0001");
    expect(formatTokenAmount(1n, 18, 2)).toBe("<0.01");
    expect(formatTokenAmount(1n, 18, 0)).toBe("<1");
  });

  it("respects the token's decimals", () => {
    expect(formatTokenAmount(1_234_567n, 6)).toBe("1.2345");
    expect(formatTokenAmount(1_000_000_000n, 6)).toBe("1,000");
    expect(formatTokenAmount(42n, 0)).toBe("42");
  });

  it("handles negative values", () => {
    expect(formatTokenAmount(-1_500n * ONE, 18)).toBe("-1,500");
  });

  it('can round to the nearest shown digit instead ("nearest"), for estimates', () => {
    const justUnder = 10_000n * ONE - 10n; // 9,999.99999...
    expect(formatTokenAmount(justUnder, 18, 2)).toBe("9,999.99");
    expect(formatTokenAmount(justUnder, 18, 2, "nearest")).toBe("10,000");
    expect(formatTokenAmount(1_005n * 10n ** 15n, 18, 2, "nearest")).toBe("1.01"); // 1.005 rounds half up
    expect(formatTokenAmount(1_004n * 10n ** 15n, 18, 2, "nearest")).toBe("1");
    expect(formatTokenAmount(1_234_567n, 6, 2, "nearest")).toBe("1.23");
    expect(formatTokenAmount(1_235_000n, 6, 2, "nearest")).toBe("1.24");
    // Nothing to round when the token has no more decimals than are shown.
    expect(formatTokenAmount(1_234_567n, 6, 6, "nearest")).toBe("1.234567");
  });
});

describe("formatTokenAmountFixed", () => {
  it("always shows the requested number of decimals", () => {
    expect(formatTokenAmountFixed(0n, 18, 6)).toBe("0.000000");
    expect(formatTokenAmountFixed(ONE, 18, 6)).toBe("1.000000");
    expect(formatTokenAmountFixed(1_234n * ONE + 567_891_234_000_000_000n, 18, 6)).toBe("1,234.567891");
    expect(formatTokenAmountFixed(5n * ONE, 18, 0)).toBe("5");
  });

  it("truncates rather than rounds", () => {
    expect(formatTokenAmountFixed(1_999_999_999_999_999_999n, 18, 2)).toBe("1.99");
  });

  it("pads tokens with fewer decimals than requested", () => {
    expect(formatTokenAmountFixed(1_500_000n, 6, 8)).toBe("1.50000000");
  });
});

describe("formatCountdown", () => {
  it("uses the two or three largest units", () => {
    expect(formatCountdown(7 * 86_400)).toBe("7d 00h 00m");
    expect(formatCountdown(6 * 86_400 + 23 * 3_600 + 12 * 60 + 59)).toBe("6d 23h 12m");
    expect(formatCountdown(4 * 3_600 + 5 * 60 + 9)).toBe("4h 05m 09s");
    expect(formatCountdown(125)).toBe("2m 05s");
    expect(formatCountdown(59.9)).toBe("59s");
  });

  it('says "ended" once there is no time left', () => {
    expect(formatCountdown(0)).toBe("ended");
    expect(formatCountdown(-5)).toBe("ended");
    expect(formatCountdown(Number.NaN)).toBe("ended");
  });
});

describe("formatUtc", () => {
  it("prints a fixed, locale-independent UTC timestamp", () => {
    expect(formatUtc(0)).toBe("1970-01-01 00:00 UTC");
    expect(formatUtc(1_700_000_000n)).toBe("2023-11-14 22:13 UTC");
    expect(formatUtc(1_700_000_000)).toBe("2023-11-14 22:13 UTC");
  });

  it("returns a dash for values that are not a date", () => {
    expect(formatUtc(Number.NaN)).toBe("-");
  });
});

describe("formatPercent", () => {
  it("converts basis points to a percentage with two decimals", () => {
    expect(formatPercent(0)).toBe("0.00%");
    expect(formatPercent(2_000)).toBe("20.00%");
    expect(formatPercent(1)).toBe("0.01%");
    expect(formatPercent(10_000)).toBe("100.00%");
  });
});

describe("shortenAddress", () => {
  it("keeps the start and the end of an address, joined by an ellipsis", () => {
    expect(shortenAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")).toBe("0x7099…79C8");
    expect(shortenAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8", 10, 8)).toBe("0x70997970…17dc79C8");
  });

  it("leaves short strings alone", () => {
    expect(shortenAddress("0x1234")).toBe("0x1234");
    // Shortening must never make a string longer.
    expect(shortenAddress("0x123456789a")).toBe("0x1234…789a");
    expect(shortenAddress("0x123456789")).toBe("0x123456789");
  });
});

describe("splitDecimal", () => {
  it("splits a formatted number at the decimal point and keeps the point with the fraction", () => {
    expect(splitDecimal("1,234.567891")).toEqual(["1,234", ".567891"]);
    expect(splitDecimal("0.000000")).toEqual(["0", ".000000"]);
  });

  it("returns an empty fraction for whole numbers", () => {
    expect(splitDecimal("42")).toEqual(["42", ""]);
    expect(splitDecimal("")).toEqual(["", ""]);
  });

  it("puts the two halves back together unchanged", () => {
    for (const text of ["500.066064", "10,000", "<0.0001", "-1,500.5"]) {
      expect(splitDecimal(text).join("")).toBe(text);
    }
  });
});

describe("tickerFractionDigits", () => {
  it("shows six decimals while the amount is small", () => {
    expect(tickerFractionDigits(0n, 18)).toBe(6);
    expect(tickerFractionDigits(500n * ONE, 18)).toBe(6);
    expect(tickerFractionDigits(9_999n * ONE + ONE - 1n, 18)).toBe(6);
  });

  it("drops decimals as the whole part grows, so the figure keeps its width", () => {
    expect(tickerFractionDigits(10_000n * ONE, 18)).toBe(4);
    expect(tickerFractionDigits(999_999n * ONE, 18)).toBe(4);
    expect(tickerFractionDigits(1_000_000n * ONE, 18)).toBe(2);
  });

  it("never asks for more decimals than the token has", () => {
    expect(tickerFractionDigits(5_000_000n, 6)).toBe(6);
    expect(tickerFractionDigits(500n, 2)).toBe(2);
    expect(tickerFractionDigits(7n, 0)).toBe(0);
    expect(tickerFractionDigits(20_000_00n, 2)).toBe(2);
  });

  it("looks at the size of the amount, not at its sign", () => {
    expect(tickerFractionDigits(-10_000n * ONE, 18)).toBe(4);
  });
});

describe("formatAge", () => {
  it("uses the largest unit that fits", () => {
    expect(formatAge(5)).toBe("5s ago");
    expect(formatAge(59.9)).toBe("59s ago");
    expect(formatAge(60)).toBe("1m ago");
    expect(formatAge(3_599)).toBe("59m ago");
    expect(formatAge(6 * 3_600 + 12)).toBe("6h ago");
    expect(formatAge(86_400)).toBe("1d ago");
    expect(formatAge(9 * 86_400 + 5)).toBe("9d ago");
  });

  it('says "just now" for the last few seconds and for anything in the future', () => {
    expect(formatAge(0)).toBe("just now");
    expect(formatAge(4.9)).toBe("just now");
    expect(formatAge(-30)).toBe("just now");
    expect(formatAge(Number.NaN)).toBe("just now");
  });
});

describe("formatFraction", () => {
  it("prints whole percent from 10% up and one decimal below", () => {
    expect(formatFraction(0.2)).toBe("20%");
    expect(formatFraction(0.995)).toBe("99%");
    expect(formatFraction(0.037)).toBe("3.7%");
    expect(formatFraction(0.0999)).toBe("9.9%");
    // Values that are not exact in binary still land on the right digit.
    expect(formatFraction(0.29)).toBe("29%");
    expect(formatFraction(0.07)).toBe("7.0%");
  });

  it("rounds down, so a gauge never claims more than there is", () => {
    expect(formatFraction(0.1999)).toBe("19%");
    expect(formatFraction(0.0379)).toBe("3.7%");
  });

  it('only says "0%" and "100%" when that is exactly true', () => {
    expect(formatFraction(0)).toBe("0%");
    expect(formatFraction(1)).toBe("100%");
    expect(formatFraction(0.0004)).toBe("<0.1%");
    expect(formatFraction(0.9995)).toBe(">99.9%");
  });

  it("treats values outside 0..1 and non-numbers as the nearest end", () => {
    expect(formatFraction(-0.5)).toBe("0%");
    expect(formatFraction(1.5)).toBe("100%");
    expect(formatFraction(Number.NaN)).toBe("0%");
  });
});

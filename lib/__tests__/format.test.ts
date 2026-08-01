import { describe, expect, it } from "vitest";
import { formatCost, formatDuration, formatNumber, formatTokens } from "../format";

describe("formatCost", () => {
  it("renders 'not priced' when priced is false, regardless of amount", () => {
    expect(formatCost({ amount: 0, priced: false })).toBe("not priced");
    expect(formatCost({ amount: 12.34, priced: false })).toBe("not priced");
    expect(formatCost({ amount: -1, priced: false })).toBe("not priced");
  });

  it("never prints $0.00 for unpriced input", () => {
    const result = formatCost({ amount: 0, priced: false });
    expect(result).not.toContain("$0.00");
    expect(result).not.toContain("$");
  });

  it("renders a real USD amount when priced is true", () => {
    expect(formatCost({ amount: 0, priced: true })).toBe("$0.00");
    expect(formatCost({ amount: 12.3, priced: true })).toBe("$12.30");
    expect(formatCost({ amount: 1234.5, priced: true })).toBe("$1,234.50");
  });
});

describe("formatNumber", () => {
  it("adds locale thousands separators", () => {
    expect(formatNumber(12345)).toBe("12,345");
    expect(formatNumber(0)).toBe("0");
  });
});

describe("formatTokens", () => {
  it("keeps small counts as plain integers", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("compacts large counts", () => {
    expect(formatTokens(1234567)).toBe("1.2M");
    expect(formatTokens(12000)).toBe("12K");
  });
});

describe("formatDuration", () => {
  it("renders '—' for null, never '0ms'", () => {
    expect(formatDuration(null)).toBe("—");
  });

  it("renders '—' for negative or non-finite values", () => {
    expect(formatDuration(-5)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("formats sub-second durations in ms", () => {
    expect(formatDuration(450)).toBe("450ms");
    expect(formatDuration(0)).toBe("0ms");
  });

  it("formats seconds with one decimal", () => {
    expect(formatDuration(3200)).toBe("3.2s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125000)).toBe("2m 5s");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(3_900_000)).toBe("1h 5m");
  });
});

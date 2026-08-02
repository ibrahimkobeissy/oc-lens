import { describe, expect, it } from "vitest";
import { clampedProgress } from "./progress";

describe("clampedProgress (code-review-2026-08-02.md L3)", () => {
  it("passes through an in-range value unchanged", () => {
    expect(clampedProgress(0)).toBe(0);
    expect(clampedProgress(42)).toBe(42);
    expect(clampedProgress(100)).toBe(100);
  });

  it("clamps a value beyond 100 or below 0 instead of translating the indicator off-canvas", () => {
    expect(clampedProgress(150)).toBe(100);
    expect(clampedProgress(-10)).toBe(0);
  });

  it("treats non-finite or missing input as 0 rather than rendering NaN%", () => {
    expect(clampedProgress(Number.NaN)).toBe(0);
    expect(clampedProgress(Number.POSITIVE_INFINITY)).toBe(100);
    expect(clampedProgress(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(clampedProgress(null)).toBe(0);
    expect(clampedProgress(undefined)).toBe(0);
  });
});

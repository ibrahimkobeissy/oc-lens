import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { selectedCalendarRange } from "./range-picker";

describe("selectedCalendarRange", () => {
  let originalTimeZone: string | undefined;

  beforeEach(() => {
    originalTimeZone = process.env.TZ;
    process.env.TZ = "Europe/Paris";
  });

  afterEach(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  });

  it("ends at the next local midnight on the 23-hour spring-forward day", () => {
    const range = selectedCalendarRange(new Date(2026, 2, 29), new Date(2026, 2, 29));
    expect(range.to - range.from).toBe(23 * 60 * 60 * 1_000);
    expect(new Date(range.to).getHours()).toBe(0);
    expect(new Date(range.to).getDate()).toBe(30);
  });

  it("ends at the next local midnight on the 25-hour fall-back day", () => {
    const range = selectedCalendarRange(new Date(2026, 9, 25), new Date(2026, 9, 25));
    expect(range.to - range.from).toBe(25 * 60 * 60 * 1_000);
    expect(new Date(range.to).getHours()).toBe(0);
    expect(new Date(range.to).getDate()).toBe(26);
  });
});

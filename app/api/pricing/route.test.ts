import { beforeEach, describe, expect, it, vi } from "vitest";

let failure: "not-found" | "schema-mismatch" = "not-found";

vi.mock("@/lib/db/connection", () => ({
  getConnection: () => ({ ok: false, reason: failure }),
}));
vi.mock("@/lib/pricing/config", () => ({
  readPricing: () => ({ version: 1, prices: {}, updatedAt: null }),
  writePricing: vi.fn(),
  PricingValidationError: class PricingValidationError extends Error {},
}));

import { GET } from "./route";

describe("OCL-142 GET /api/pricing database states", () => {
  beforeEach(() => { failure = "not-found"; });

  it("reports a missing database instead of returning zero observed models", async () => {
    const response = await GET();
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: expect.objectContaining({ code: "database_not_found" }),
    });
  });

  it("reports an incompatible schema instead of returning zero observed models", async () => {
    failure = "schema-mismatch";
    const response = await GET();
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: expect.objectContaining({ code: "schema_mismatch" }),
    });
  });
});

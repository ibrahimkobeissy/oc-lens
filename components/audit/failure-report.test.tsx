import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FailuresReport } from "@/lib/audit/failure-types";
import { FailureReport, resendCostLabel } from "./failure-report";

vi.mock("@/components/charts/bar-chart-card", () => ({ BarChartCard: () => <div>chart marker</div> }));

const zero = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
const kinds = { "rate-limit": 1, "provider-down": 0, auth: 0, "invalid-request": 0, "provider-error": 0, aborted: 0, unknown: 0 };

function report(failedCallsWithUsage: number): FailuresReport {
  return {
    summary: { failedCalls: 1, byKind: kinds, incidents: 1, recovered: 1, autoResends: 2, userResends: 1, resendTokens: { ...zero, input: 46_407 }, resendCostAmount: 0, resendUnpriced: 1, failedCallsWithUsage, failedCallTokens: { ...zero, input: failedCallsWithUsage * 10 } },
    byDay: [{ date: "2026-10-01", total: 1, ...kinds }],
    incidents: [{
      sessionId: "ses_1", sessionTitle: "Refactor auth", firstFailureAt: 1_000, autoResends: 2, userResends: 1, providerFault: true,
      failures: [{ messageId: "m1", timeCreated: 1_000, providerID: "acme", modelID: "big", kind: "rate-limit", rawType: "provider.rate-limit", status: 429, message: "Too many tokens per minute", tokens: null }],
      recovery: { messageId: "m2", timeCreated: 61_000, providerID: "acme", modelID: "big", tokens: { ...zero, input: 46_407 }, cost: { amount: 0, priced: false } },
    }],
  };
}

describe("FailureReport", () => {
  it("shows failures, resends, and what the resend paid, without NaN", () => {
    const html = renderToStaticMarkup(<FailureReport report={report(0)} />);
    for (const text of ["Failed model calls", "Tokens paid by resends", "46,407", "Refactor auth", "Rate limit (TPM/RPM)", "429", "Too many tokens per minute", "2 auto · 1 by you", "No failed call reported any usage"]) expect(html).toContain(text);
    expect(html).toContain('href="/sessions/ses_1"');
    expect(html).not.toContain("NaN");
  });

  it("warns when a failed call still reported usage", () => {
    expect(renderToStaticMarkup(<FailureReport report={report(2)} />)).toContain("2 failed calls still reported usage");
  });

  it("labels resend cost honestly", () => {
    expect(resendCostLabel(0, 1, 0)).toBe("not priced");
    expect(resendCostLabel(1.5, 1, 1)).toBe("$1.50 (partial)");
    expect(resendCostLabel(1.5, 0, 2)).toBe("$1.50");
  });
});

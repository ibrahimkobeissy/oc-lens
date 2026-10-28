import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FailureIncident, SessionFailureReport } from "@/lib/audit/failure-types";
import { FailureTurnBanner, replayFailureMarks } from "./failure-marks";
import { SessionFailures } from "./session-failures";

const zero = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
const incident: FailureIncident = {
  sessionId: "ses_1", sessionTitle: "t", firstFailureAt: 1_000, autoResends: 2, userResends: 1, providerFault: true,
  failures: [
    { messageId: "f1", timeCreated: 1_000, providerID: "acme", modelID: "big", kind: "rate-limit", rawType: "provider.rate-limit", status: 429, message: "Too many tokens per minute", tokens: null, retries: null, accepted: false, succeeded: false },
    { messageId: "f2", timeCreated: 2_000, providerID: "acme", modelID: "big", kind: "rate-limit", rawType: "provider.rate-limit", status: 429, message: null, tokens: { ...zero, input: 500 }, retries: 3, accepted: false, succeeded: false },
  ],
  resends: [{ messageId: "u1", by: "opencode" }, { messageId: "u2", by: "opencode" }, { messageId: "u3", by: "you" }],
  before: { messageId: "ok0", tokens: { ...zero, input: 3_806, cacheRead: 40_704 } },
  recovery: { messageId: "ok1", timeCreated: 9_000, providerID: "acme", modelID: "big", tokens: { ...zero, input: 46_407 }, cost: { amount: 0, priced: false } },
  cacheLost: { tokens: 40_704, extraCost: { amount: 0.1832, priced: true } },
  repeatedCalls: [{ partId: "p9", messageId: "ok1", tool: "shell", originalPartId: "p1" }],
  acceptedUnrecorded: null,
};
const report: SessionFailureReport = {
  incidents: [incident],
  overhead: { failedCalls: 2, failedCallTokens: { ...zero, input: 500 }, cacheLostTokens: 40_704, cacheLostExtraAmount: 0.1832, cacheLostUnpriced: 0, repeatedCalls: 1, hiddenRetries: 3, acceptedUnrecordedRequests: 0, acceptedUnrecordedTokens: 0 },
};

describe("replay failure marks", () => {
  it("marks every failed call, resend, recovery, and redone call", () => {
    const marks = replayFailureMarks(report);
    expect([...marks.turns].map(([id, mark]) => [id, mark.type])).toEqual([
      ["f1", "failed"], ["f2", "failed"], ["u1", "resend"], ["u2", "resend"], ["u3", "resend"], ["ok1", "recovery"],
    ]);
    expect(marks.repeatedParts.get("p9")).toBe("p1");
  });

  it("says what each marked turn is", () => {
    const marks = replayFailureMarks(report);
    const html = (id: string) => renderToStaticMarkup(<FailureTurnBanner mark={marks.turns.get(id)} />);
    expect(html("f1")).toContain("Rate limit (TPM/RPM) · HTTP 429 · attempt 1 of 2");
    expect(html("f1")).toContain("No tokens were recorded on this call");
    expect(html("f2")).toContain("500 tokens were recorded on this failed call");
    expect(html("f2")).toContain("opencode retried this call 3 times inside this step");
    expect(html("u1")).toContain("Automatic resend by opencode");
    expect(html("u3")).toContain("You resent after a failed call");
    expect(html("ok1")).toContain("Replay of a failed call");
    expect(html("ok1")).toContain("40,704 tokens of context were paid at the full input price instead of the cache price: +$0.18");
    expect(renderToStaticMarkup(<FailureTurnBanner mark={undefined} />)).toBe("");
  });
});

describe("hidden retries and accepted requests", () => {
  const transport: FailureIncident = {
    ...incident,
    failures: [{ messageId: "t1", timeCreated: 1_000, providerID: "acme", modelID: "big", kind: "transport", rawType: "provider.transport", status: 200, message: "stream ended", tokens: null, retries: 6, accepted: true, succeeded: false }],
    resends: [{ messageId: "c1", by: "opencode" }],
    acceptedUnrecorded: { requests: 6, tokensPerRequest: 40_455, tokens: 242_730 },
  };
  const retriedThenOk: FailureIncident = {
    ...incident,
    failures: [{ messageId: "ok1", timeCreated: 9_000, providerID: "acme", modelID: "big", kind: "rate-limit", rawType: "provider.rate-limit", status: 429, message: null, tokens: null, retries: 2, accepted: false, succeeded: true }],
    resends: [], repeatedCalls: [], cacheLost: null, acceptedUnrecorded: null,
  };

  it("estimates what a broken, accepted stream may have billed — and says it is an estimate", () => {
    const marks = replayFailureMarks({ incidents: [transport], overhead: report.overhead });
    const html = renderToStaticMarkup(<FailureTurnBanner mark={marks.turns.get("t1")} />);
    expect(html).toContain("Stream broke mid-response · HTTP 200");
    expect(html).toContain("opencode retried this call 6 times inside this step");
    expect(html).toContain("The provider accepted 6 requests (HTTP 2xx)");
    expect(html).toContain("≈242,730 tokens the provider may have billed. An estimate");
  });

  it("shows a step that succeeded after retries as one marker, not a failure plus a recovery", () => {
    const marks = replayFailureMarks({ incidents: [retriedThenOk], overhead: report.overhead });
    expect(marks.turns.get("ok1")?.type).toBe("recovery");
    const html = renderToStaticMarkup(<FailureTurnBanner mark={marks.turns.get("ok1")} />);
    expect(html).toContain("Succeeded after hidden retries");
    expect(html).toContain("This step failed 2 times first (Rate limit (TPM/RPM), HTTP 429)");
  });
});

describe("SessionFailures", () => {
  it("separates certain extra tokens, cache lost, and redone calls from the session total", () => {
    const html = renderToStaticMarkup(<SessionFailures report={report} sessionTokens={{ ...zero, input: 120_000 }} onJumpToMessage={() => undefined} />);
    for (const text of ["Failed calls in this session", "120,000", "Recorded on failed calls", "500", "Cache lost after a failure", "40,704", "+$0.18", "Calls redone after a failure", "Go to failure", "Go to replay"]) expect(html).toContain(text);
    expect(html).not.toContain("NaN");
  });

  it("renders nothing for a session without failures", () => {
    const empty: SessionFailureReport = { incidents: [], overhead: { ...report.overhead, failedCalls: 0 } };
    expect(renderToStaticMarkup(<SessionFailures report={empty} sessionTokens={zero} onJumpToMessage={() => undefined} />)).toBe("");
  });
});

describe("turn index flags", () => {
  it("flags errors, repeats, slow starts, resends, and tool calls per turn", async () => {
    const { turnFlags } = await import("./session-sidebar");
    const toolPart = (id: string, status: "completed" | "error") => ({ id, data: { type: "tool", tool: "shell", callID: id, status, input: {}, output: null, error: null, title: null, metadata: null, timeStart: null, timeEnd: null } });
    const base = { role: "assistant" as const, agent: null, timeCreated: 1, timeCompleted: null, durationMs: null, tokens: null, cost: { amount: 0, priced: false } };
    const marks = replayFailureMarks(report, [{ messageId: "ok1", sessionId: "s", sessionTitle: "t", timeCreated: 1, model: "m", waitSeconds: 90, baselineSeconds: 5 }]);
    const recovery = { ...base, messageId: "ok1", parts: [toolPart("p9", "completed"), toolPart("p10", "error")] } as unknown as Parameters<typeof turnFlags>[0];
    expect(turnFlags(recovery, undefined, marks)).toEqual({ toolCalls: 2, error: true, loop: true, slowStart: true, resend: false });
    const failed = { ...base, messageId: "f1", parts: [] } as unknown as Parameters<typeof turnFlags>[0];
    expect(turnFlags(failed, undefined, marks)).toMatchObject({ toolCalls: 0, error: true, loop: false });
    const resend = { ...base, role: "user", messageId: "u1", parts: [] } as unknown as Parameters<typeof turnFlags>[0];
    expect(turnFlags(resend, undefined, marks)).toMatchObject({ resend: true, error: false });
  });
});

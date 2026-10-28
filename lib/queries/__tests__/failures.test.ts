import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";

import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";
import { ensureCanonicalViews } from "@/lib/db/canonical";
import { openReadOnly } from "@/lib/db/connection";
import { classifyFailure, failureReport, sessionFailureReport } from "@/lib/queries/failures";
import { buildV2Fixture, V2_MODEL, V2_T0 } from "@/test/fixtures/v2-fixture";
import type { PricingConfig } from "@/types/oc";

const dir = makeTempDir();
afterAll(() => cleanupTempDir(dir));

const NO_PRICES: PricingConfig = { version: 1, prices: {}, updatedAt: 0 };
const PRICED: PricingConfig = { version: 1, prices: { "acme/m-large": { inputPerMTok: 1, outputPerMTok: 0, cacheReadPerMTok: 0, cacheWritePerMTok: 0, currency: "USD" } }, updatedAt: 0 };
const TOKENS = { input: 40_000, output: 10, reasoning: 0, cache: { read: 0, write: 0 } };
const WARM = { input: 2_000, output: 10, reasoning: 0, cache: { read: 36_000, write: 0 } };
const readCall = (id: string, time: number, filePath: string) => ({ type: "tool", id, name: "read", state: { status: "completed", input: { filePath }, content: [{ type: "text", text: "…" }] }, time: { created: time, completed: time + 1 } });

/** A 2.x session: a rate-limited step, three opencode auto-resends that also fail, the user resending, then success. */
function v2Db(): string {
  const path = join(dir, "v2-failures.db");
  buildV2Fixture(path);
  const db = new DatabaseSync(path);
  const t = V2_T0 + 10_000;
  db.prepare(`INSERT INTO session_v2 (id, project_id, slug, directory, title, version, agent, model, time_created, time_updated)
    VALUES ('ses_rl', 'prj_alpha', 'rate-limited', '/w/alpha', 'Rate limited work', '2.2.0', 'build', ?, ?, ?)`).run(JSON.stringify(V2_MODEL), t, t);
  const insert = db.prepare("INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, 'ses_rl', ?, ?, ?, ?, ?)");
  const rateLimited = (time: number) => ({ agent: "build", model: V2_MODEL, content: [], finish: "error", time: { created: time }, error: { type: "provider.rate-limit", message: "Too many tokens per minute", status: 429, response: { body: "secret-body-must-not-leak" } } });
  const rows: Array<[string, string, Record<string, unknown>]> = [
    ["msg_r00", "user", { text: "Refactor", time: { created: t } }],
    ["msg_r00b", "assistant", { agent: "build", model: V2_MODEL, content: [readCall("call_a", t + 0.5, "/w/alpha/a.ts")], cost: 0, tokens: WARM, finish: "tool-calls", time: { created: t + 0.5, completed: t + 0.7 } }],
    ["msg_r01", "assistant", rateLimited(t + 1)],
    ["msg_r02", "idle", { outcome: "failed", time: { created: t + 2 } }],
    ["msg_r03", "synthetic", { text: "Continue", time: { created: t + 3 } }],
    ["msg_r04", "assistant", rateLimited(t + 4)],
    ["msg_r05", "synthetic", { text: "Continue", time: { created: t + 5 } }],
    ["msg_r06", "synthetic", { text: "Continue", time: { created: t + 6 } }],
    ["msg_r07", "user", { text: "try again", time: { created: t + 60_000 } }],
    ["msg_r08", "assistant", { agent: "build", model: V2_MODEL, content: [readCall("call_a2", t + 60_002, "/w/alpha/a.ts"), readCall("call_b", t + 60_003, "/w/alpha/b.ts"), { type: "text", text: "done" }], cost: 0, tokens: TOKENS, finish: "stop", time: { created: t + 60_001, completed: t + 60_010 } }],
    ["msg_r09", "user", { text: "stop", time: { created: t + 70_000 } }],
    ["msg_r09b", "assistant", { agent: "build", model: V2_MODEL, content: [readCall("call_a3", t + 70_000.5, "/w/alpha/a.ts")], cost: 0, tokens: WARM, finish: "tool-calls", time: { created: t + 70_000.5 } }],
    ["msg_r10", "assistant", { agent: "build", model: V2_MODEL, content: [], tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: t + 70_001 }, error: { type: "aborted", message: "The operation was aborted." } }],
  ];
  rows.forEach(([id, type, data], seq) => insert.run(id, type, seq, (data.time as { created: number }).created, (data.time as { created: number }).created, JSON.stringify(data)));

  // Shapes from a real opencode 2.x export (data-model §8.7): a broken stream the provider accepted, retried 6 times.
  const u = V2_T0 + 30_000_000;
  db.prepare(`INSERT INTO session_v2 (id, project_id, slug, directory, title, version, agent, model, time_created, time_updated)
    VALUES ('ses_tr', 'prj_alpha', 'transport', '/w/alpha', 'Broken stream', '2.2.0', 'build', ?, ?, ?)`).run(JSON.stringify(V2_MODEL), u, u);
  const tr = db.prepare("INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, 'ses_tr', ?, ?, ?, ?, ?)");
  const transportError = { type: "provider.transport", message: "stream ended unexpectedly", status: 200, response: { body: "secret-body-must-not-leak" } };
  const trRows: Array<[string, string, Record<string, unknown>]> = [
    ["msg_t00", "user", { text: "Build it", time: { created: u } }],
    ["msg_t01", "assistant", { agent: "build", model: V2_MODEL, content: [], cost: 0, tokens: WARM, finish: "tool-calls", time: { created: u + 1 } }],
    ["msg_t02", "assistant", { agent: "build", model: V2_MODEL, content: [], finish: "error", time: { created: u + 2 }, error: transportError, retry: { attempt: 6, at: u + 60, error: transportError } }],
    ["msg_t03", "synthetic", { text: "The previous response was interrupted. Continue from where you left off.", time: { created: u + 61 } }],
    ["msg_t04", "assistant", { agent: "build", model: V2_MODEL, content: [], cost: 0, tokens: WARM, finish: "tool-calls", time: { created: u + 62 } }],
    ["msg_t05", "assistant", { agent: "build", model: V2_MODEL, content: [], cost: 0, tokens: WARM, finish: "stop", time: { created: u + 70 }, retry: { attempt: 2, at: u + 69, error: { type: "provider.rate-limit", message: "slow down", status: 429 } } }],
    ["msg_t06", "assistant", { agent: "build", model: V2_MODEL, content: [], finish: "error", time: { created: u + 80 }, error: { type: "provider.internal", message: "boom", status: 500 } }],
    ["msg_t07", "synthetic", { text: "<result>", description: "Subagent result", metadata: { source: "subagent", childID: "ses_child", agent: "review", state: "completed" }, time: { created: u + 81 } }],
  ];
  trRows.forEach(([id, type, data], seq) => tr.run(id, type, seq, (data.time as { created: number }).created, (data.time as { created: number }).created, JSON.stringify(data)));
  db.close();
  return path;
}

function withDb<T>(path: string, run: (db: DatabaseSync) => T): T {
  const db = openReadOnly(path);
  try { ensureCanonicalViews(db); return run(db); } finally { db.close(); }
}

describe("classifyFailure", () => {
  it("trusts the HTTP status, then opencode's label, and never hides an unknown one", () => {
    expect(classifyFailure("provider.error", 429)).toBe("rate-limit");
    expect(classifyFailure("APIError", 503)).toBe("provider-down");
    expect(classifyFailure("APIError", 401)).toBe("auth");
    expect(classifyFailure("provider.internal", null)).toBe("provider-down");
    expect(classifyFailure("MessageAbortedError", null)).toBe("aborted");
    expect(classifyFailure("provider.overloaded", null)).toBe("provider-error");
    expect(classifyFailure("SomethingNew", null)).toBe("unknown");
  });
});

describe("failureReport on opencode 2.x", () => {
  const path = v2Db();

  it("links failures, auto resends, user resends, and the step that paid for the resend", () => withDb(path, (db) => {
    const report = failureReport(db, NO_PRICES);
    const incident = report.incidents.find((candidate) => candidate.sessionId === "ses_rl" && candidate.providerFault);
    expect(incident).toMatchObject({
      sessionTitle: "Rate limited work",
      // r03 and r05 directly follow a failed step; r06 follows r05, so it is not a resend.
      autoResends: 2,
      userResends: 1,
      recovery: { messageId: "msg_r08", tokens: { input: 40_000, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cost: { priced: false } },
    });
    expect(incident?.failures.map((call) => [call.kind, call.status, call.rawType])).toEqual([["rate-limit", 429, "provider.rate-limit"], ["rate-limit", 429, "provider.rate-limit"]]);
    expect(JSON.stringify(report)).not.toContain("secret-body-must-not-leak");
  }));

  it("measures cache lost and redone calls instead of calling the whole replay waste", () => withDb(path, (db) => {
    const report = sessionFailureReport(db, PRICED, "ses_rl");
    const [first, cancelled] = report.incidents;
    expect(first?.before).toMatchObject({ messageId: "msg_r00b" });
    expect(first?.resends.map((resend) => resend.by)).toEqual(["opencode", "opencode", "you"]);
    // The warm step read 36,000 from cache; the replay read none, so all 36,000 were paid at the input price.
    expect(first?.cacheLost?.tokens).toBe(36_000);
    expect(first?.cacheLost?.extraCost.amount).toBeCloseTo(0.036);
    // a.ts was read before the failure and again after the replay; b.ts is new work.
    expect(first?.repeatedCalls.map((call) => [call.tool, call.messageId])).toEqual([["read", "msg_r08"]]);
    // A repeat in the user's next turn is new work, not a redo of the failed one.
    expect(cancelled?.repeatedCalls).toEqual([]);
    expect(report.overhead).toMatchObject({ failedCalls: 3, cacheLostTokens: 36_000, repeatedCalls: 1, cacheLostUnpriced: 0 });
    expect(report.overhead.failedCallTokens).toEqual({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
  }));

  it("leaves cache loss unpriced rather than $0 when the model has no price", () => withDb(path, (db) => {
    const { overhead } = sessionFailureReport(db, NO_PRICES, "ses_rl");
    expect(overhead).toMatchObject({ cacheLostTokens: 36_000, cacheLostExtraAmount: 0, cacheLostUnpriced: 1 });
  }));

  it("keeps a user cancellation out of the resend totals and counts zero-usage failures as no usage", () => withDb(path, (db) => {
    const { summary, incidents } = failureReport(db, PRICED, "UTC", { to: V2_T0 + 20_000_000 });
    const aborted = incidents.find((incident) => !incident.providerFault);
    expect(aborted?.failures[0]?.kind).toBe("aborted");
    expect(summary).toMatchObject({ failedCalls: 3, recovered: 1, autoResends: 2, userResends: 1, failedCallsWithUsage: 0, resendUnpriced: 0 });
    expect(summary.resendTokens.input).toBe(40_000);
    expect(summary.resendCostAmount).toBeCloseTo(0.04);
    expect(summary.byKind).toMatchObject({ "rate-limit": 2, aborted: 1 });
  }));

  it("filters incidents by when they started and buckets days in the given zone", () => withDb(path, (db) => {
    expect(failureReport(db, NO_PRICES, "UTC", { from: V2_T0 + 10_005, to: V2_T0 + 20_000_000 }).incidents).toHaveLength(1);
    expect(failureReport(db, NO_PRICES, "UTC", { to: V2_T0 + 20_000_000 }).byDay.reduce((sum, day) => sum + day.total, 0)).toBe(3);
  }));
});

describe("what opencode hides inside a step", () => {
  const path = v2Db();

  it("flags a broken stream the provider accepted, with an estimate sized from the step before", () => withDb(path, (db) => {
    const [transport] = sessionFailureReport(db, NO_PRICES, "ses_tr").incidents;
    expect(transport?.failures[0]).toMatchObject({ kind: "transport", status: 200, retries: 6, accepted: true, succeeded: false, tokens: null });
    // Each of the 6 accepted attempts resent the 38,000-token context of msg_t01.
    expect(transport?.acceptedUnrecorded).toEqual({ requests: 6, tokensPerRequest: 38_000, tokens: 228_000 });
    expect(transport?.resends).toEqual([{ messageId: "msg_t03", by: "opencode" }]);
    expect(JSON.stringify(transport)).not.toContain("secret-body-must-not-leak");
  }));

  it("surfaces a step that retried and then succeeded as its own incident", () => withDb(path, (db) => {
    const retried = sessionFailureReport(db, NO_PRICES, "ses_tr").incidents.find((incident) => incident.failures.some((call) => call.succeeded));
    expect(retried?.failures).toEqual([expect.objectContaining({ messageId: "msg_t05", kind: "rate-limit", status: 429, retries: 2, accepted: false, succeeded: true })]);
    expect(retried?.recovery?.messageId).toBe("msg_t05");
    expect(retried?.acceptedUnrecorded).toBeNull();
  }));

  it("never counts a subagent result that arrives after a failure as a resend", () => withDb(path, (db) => {
    const report = sessionFailureReport(db, NO_PRICES, "ses_tr");
    const last = report.incidents.at(-1);
    expect(last?.failures[0]?.kind).toBe("provider-down");
    expect(last?.resends).toEqual([]);
    expect(report.overhead).toMatchObject({ failedCalls: 2, hiddenRetries: 8, acceptedUnrecordedRequests: 6, acceptedUnrecordedTokens: 228_000 });
  }));
});

describe("failureReport on opencode 1.x", () => {
  it("reads the legacy error{name, data{statusCode}} shape and flags usage recorded on a failure", () => {
    const path = join(dir, "v1-failures.db");
    createFullSchemaDb(path);
    const db = new DatabaseSync(path);
    const insert = db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, 'ses_1', ?, ?, ?)");
    insert.run("msg_e1", 10, 10, JSON.stringify({ role: "assistant", providerID: "p", modelID: "m", time: { created: 10 }, tokens: { input: 900, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, error: { name: "APIError", data: { message: "Overloaded", statusCode: 529, isRetryable: true, responseBody: "secret-body-must-not-leak" } } }));
    insert.run("msg_u2", 20, 20, JSON.stringify({ role: "user", time: { created: 20 } }));
    insert.run("msg_a2", 30, 30, JSON.stringify({ role: "assistant", providerID: "p", modelID: "m", time: { created: 30 }, tokens: { input: 900, output: 5, reasoning: 0, cache: { read: 0, write: 0 } } }));
    db.close();

    withDb(path, (conn) => {
      const report = failureReport(conn, NO_PRICES);
      expect(report.incidents[0]?.failures[0]).toMatchObject({ kind: "provider-down", status: 529, rawType: "APIError", message: "Overloaded", tokens: { input: 900 } });
      expect(report.summary).toMatchObject({ failedCallsWithUsage: 1, userResends: 1, recovered: 1 });
      expect(JSON.stringify(report)).not.toContain("secret-body-must-not-leak");
    });
  });
});

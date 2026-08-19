import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { withFixture } from "../index";
import { LOOP_SCENARIOS, LOOP_TURN_USAGE, MINIMUMS } from "../manifest";

/**
 * Structural assertions about the planted loop scenarios (manifest
 * `LOOP_SCENARIOS`). These check what is *in the data* — call counts, statuses,
 * input shapes, signature counts, content revisits.
 *
 * They deliberately stop short of asserting `expectedIncidents`: that is a
 * claim about detector behaviour and belongs to the detector's own test, once
 * `lib/queries/loops.ts` exists. What this file guarantees is that the ground
 * truth the detector will be judged against is actually present and correct.
 */

interface ToolCall {
  tool: string;
  state?: { status?: string; input?: Record<string, unknown> };
}

/** Stable canonical form — key order must not change a signature. */
function canon(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(obj[k])}`)
    .join(",")}}`;
}

/**
 * A call is signaturable only when opencode actually recorded a non-empty
 * input. Absent or `{}` input returns null: two such calls look identical but
 * nothing is known about them, so claiming they repeat would be a fabrication.
 */
function signature(call: ToolCall): string | null {
  const input = call.state?.input;
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length === 0) return null;
  return `${call.tool}:${createHash("sha1").update(canon(input)).digest("hex").slice(0, 12)}`;
}

function toolCalls(sessionId: string): ToolCall[] {
  return withFixture((db) => {
    const rows = db
      .prepare(
        `SELECT data FROM part
         WHERE session_id = ? AND json_extract(data,'$.type') = 'tool'
         ORDER BY time_created, id`,
      )
      .all(sessionId) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as ToolCall);
  });
}

describe("planted loop scenarios", () => {
  it("appends six scripted loop sessions after the 120 random ones", () => {
    withFixture((db) => {
      const ids = Object.values(LOOP_SCENARIOS).map((s) => s.sessionId);
      expect(ids.length).toBe(MINIMUMS.loopSessions);
      const placeholders = ids.map(() => "?").join(",");
      const row = db
        .prepare(`SELECT COUNT(*) as c FROM session WHERE id IN (${placeholders})`)
        .get(...ids) as { c: number };
      expect(row.c).toBe(MINIMUMS.loopSessions);

      const total = db.prepare("SELECT COUNT(*) as c FROM session").get() as { c: number };
      expect(total.c).toBe(120 + MINIMUMS.loopSessions);
    });
  });

  it("is dated past the random span, so date-range filters do not sweep it up", () => {
    withFixture((db) => {
      const ids = Object.values(LOOP_SCENARIOS).map((s) => s.sessionId);
      const placeholders = ids.map(() => "?").join(",");
      const row = db
        .prepare(
          `SELECT MIN(time_created) as planted FROM session WHERE id IN (${placeholders})`,
        )
        .get(...ids) as { planted: number };
      const random = db
        .prepare(
          `SELECT MAX(time_created) as latest FROM session WHERE id NOT IN (${placeholders})`,
        )
        .get(...ids) as { latest: number };
      expect(row.planted).toBeGreaterThan(random.latest);
    });
  });

  for (const [name, scenario] of Object.entries(LOOP_SCENARIOS)) {
    describe(name, () => {
      it("has the exact tool-call count and signature count the manifest declares", () => {
        const calls = toolCalls(scenario.sessionId);
        expect(calls.length).toBe(scenario.sessionCalls);

        const signatures = calls.map(signature).filter((s): s is string => s !== null);
        expect(new Set(signatures).size).toBe(scenario.sessionSignatures);
      });

      it("carries deterministic per-turn token usage so wasted cost is exactly computable", () => {
        withFixture((db) => {
          const rows = db
            .prepare("SELECT data FROM message WHERE session_id = ?")
            .all(scenario.sessionId) as Array<{ data: string }>;
          const assistant = rows
            .map((r) => JSON.parse(r.data) as { role?: string; tokens?: { input?: number; output?: number } })
            .filter((m) => m.role === "assistant");
          expect(assistant.length).toBe(scenario.sessionCalls);
          for (const message of assistant) {
            expect(message.tokens?.input).toBe(LOOP_TURN_USAGE.input);
            expect(message.tokens?.output).toBe(LOOP_TURN_USAGE.output);
          }
        });
      });
    });
  }

  it("errorRetry repeats one byte-identical failing call", () => {
    const calls = toolCalls(LOOP_SCENARIOS.errorRetry.sessionId);
    expect(calls.every((c) => c.state?.status === "error")).toBe(true);
    expect(new Set(calls.map(signature)).size).toBe(1);
  });

  it("redundantRepeat repeats one byte-identical successful call", () => {
    const calls = toolCalls(LOOP_SCENARIOS.redundantRepeat.sessionId);
    expect(calls.every((c) => c.state?.status === "completed")).toBe(true);
    expect(new Set(calls.map(signature)).size).toBe(1);
  });

  it("oscillation revisits an earlier content on one path — the A→B→A→B shape", () => {
    const calls = toolCalls(LOOP_SCENARIOS.oscillation.sessionId);
    const paths = new Set(calls.map((c) => c.state?.input?.["filePath"]));
    expect(paths.size).toBe(1); // one file, so this is a flip-flop and not progress

    const contents = calls.map((c) => String(c.state?.input?.["content"]));
    expect(new Set(contents).size).toBe(2);
    // Every content is written more than once: the session ends where it began.
    for (const value of new Set(contents)) {
      expect(contents.filter((c) => c === value).length).toBeGreaterThan(1);
    }
  });

  it("unsignaturable carries both no-input shapes and yields no signatures at all", () => {
    const calls = toolCalls(LOOP_SCENARIOS.unsignaturable.sessionId);
    const missingKey = calls.filter((c) => c.state !== undefined && !("input" in c.state));
    const emptyObject = calls.filter((c) => c.state?.input && Object.keys(c.state.input).length === 0);
    expect(missingKey.length).toBe(2);
    expect(emptyObject.length).toBe(2);
    expect(calls.every((c) => signature(c) === null)).toBe(true);
  });

  it("interleavedRepeat separates its repeats with unrelated calls", () => {
    const calls = toolCalls(LOOP_SCENARIOS.interleavedRepeat.sessionId);
    const signatures = calls.map(signature);
    const bash = signatures.filter((s) => s?.startsWith("bash:"));
    expect(bash.length).toBe(LOOP_SCENARIOS.interleavedRepeat.incidentCalls);
    expect(new Set(bash).size).toBe(1);
    // The repeats are never adjacent — a consecutive-run detector would miss them.
    for (let i = 1; i < signatures.length; i++) {
      expect(signatures[i] === null || signatures[i] !== signatures[i - 1]).toBe(true);
    }
  });

  it("control never repeats a signature or revisits a content — it must not be flagged", () => {
    const calls = toolCalls(LOOP_SCENARIOS.control.sessionId);
    const signatures = calls.map(signature);
    expect(signatures.every((s) => s !== null)).toBe(true);
    expect(new Set(signatures).size).toBe(calls.length);

    // The 3 edits share one path but every content differs: iteration, not oscillation.
    const edits = calls.filter((c) => c.tool === "edit");
    expect(new Set(edits.map((c) => c.state?.input?.["filePath"])).size).toBe(1);
    expect(new Set(edits.map((c) => String(c.state?.input?.["content"]))).size).toBe(edits.length);
  });
});

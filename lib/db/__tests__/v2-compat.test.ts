import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { detectGeneration, ensureCanonicalViews } from "../canonical";
import { openReadOnly, query } from "../connection";
import { DENYLISTED_TABLES } from "../denylist";
import { checkSchema } from "../schema-guard";
import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "./test-db";
import { loopDiagnostics } from "@/lib/diagnostics/loop-report";
import { costBreakdown } from "@/lib/pricing/breakdown";
import { agentSwitchEvents, agentUsage } from "@/lib/queries/agents";
import { getOverviewStats, listProjects } from "@/lib/queries/projects";
import { detectLoops } from "@/lib/queries/loops";
import { getReplay, subagentTree } from "@/lib/queries/replay";
import { listSessions } from "@/lib/queries/sessions";
import { readTodos } from "@/lib/queries/todos";
import { featureAdoption, fileChanges, skillUsage, toolUsage } from "@/lib/queries/tools";
import {
  buildMixedFixture,
  buildV2Fixture,
  LEGACY_ONLY_SESSION,
  MIGRATED_SESSION,
  MIGRATED_V2_TOKENS,
  SHELL_RETRY_COMMAND,
  V2_CHILD_SESSION,
  V2_MAIN_SESSION,
  V2_MAIN_TOKENS,
  V2_MODEL,
  V2_UNTITLED_SESSION,
} from "@/test/fixtures/v2-fixture";
import type { PricingConfig } from "@/types/oc";

const PRICING: PricingConfig = {
  version: 1,
  prices: { [`${V2_MODEL.providerID}/${V2_MODEL.id}`]: { inputPerMTok: 1, outputPerMTok: 1, cacheReadPerMTok: 1, cacheWritePerMTok: 1, currency: "USD" } },
  updatedAt: 1,
};

let dir: string;
let v2Path: string;
let mixedPath: string;

beforeAll(() => {
  dir = makeTempDir();
  v2Path = join(dir, "v2.db");
  mixedPath = join(dir, "mixed.db");
  buildV2Fixture(v2Path);
  buildMixedFixture(mixedPath);
});

afterAll(() => cleanupTempDir(dir));

function withDb<T>(path: string, cb: (db: DatabaseSync) => T): T {
  const db = openReadOnly(path);
  try {
    return cb(db);
  } finally {
    db.close();
  }
}

describe("schema generation detection and guard", () => {
  it("recognises v1-only, v2-only, and mixed databases", () => {
    const v1Path = join(dir, "v1.db");
    createFullSchemaDb(v1Path);
    expect(withDb(v1Path, detectGeneration)).toBe("v1");
    expect(withDb(v2Path, detectGeneration)).toBe("v2");
    expect(withDb(mixedPath, detectGeneration)).toBe("mixed");
  });

  it("accepts the verified v2 and mixed schemas", () => {
    expect(withDb(v2Path, checkSchema)).toBeNull();
    expect(withDb(mixedPath, checkSchema)).toBeNull();
  });

  it("names the missing session_message column rather than reading a malformed v2 transcript", () => {
    const path = join(dir, "v2-broken.db");
    buildV2Fixture(path);
    const writable = new DatabaseSync(path);
    writable.exec("DROP INDEX session_message_session_seq_idx; DROP INDEX session_message_session_type_seq_idx; ALTER TABLE session_message DROP COLUMN seq");
    writable.close();
    expect(withDb(path, checkSchema)).toEqual({ table: "session_message", missingColumns: ["seq"] });
  });

  it("refuses a mixed database whose legacy tables are only half present", () => {
    const path = join(dir, "mixed-broken.db");
    buildMixedFixture(path);
    const writable = new DatabaseSync(path);
    writable.exec("DROP TABLE part");
    writable.close();
    expect(withDb(path, checkSchema)?.table).toBe("part");
  });
});

describe("read-only guarantee on v2 and mixed databases", () => {
  it("installs only connection-private TEMP views and leaves the file byte-identical", () => {
    const hash = () => createHash("sha256").update(readFileSync(mixedPath)).digest("hex");
    const before = hash();
    withDb(mixedPath, (db) => {
      expect(ensureCanonicalViews(db)).toBe("mixed");
      listSessions(db, {}, PRICING);
      getReplay(db, MIGRATED_SESSION, [], PRICING);
      const mainObjects = query<{ name: string }>(db, "SELECT name FROM main.sqlite_master WHERE type = 'view'");
      expect(mainObjects).toEqual([]);
      expect(() => db.exec("INSERT INTO main.session_v2 (id) VALUES ('x')")).toThrow();
    });
    expect(hash()).toBe(before);
  });

  it("rebuilds the cached 2.x projection when opencode commits, and only then", () => {
    const path = join(dir, "v2-live.db");
    buildV2Fixture(path);
    const reader = openReadOnly(path);
    try {
      const userCount = () => listSessions(reader, { id: V2_MAIN_SESSION }).data[0]!.messageCounts.user;
      expect(userCount()).toBe(3);
      const writer = new DatabaseSync(path);
      writer.prepare("INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES ('msg_m99', ?, 'user', 99, 1, 1, ?)")
        .run(V2_MAIN_SESSION, JSON.stringify({ text: "One more thing", time: { created: 1 } }));
      writer.close();
      expect(userCount()).toBe(4);
      expect(query<{ name: string }>(reader, "SELECT name FROM main.sqlite_master WHERE name LIKE 'oc_lens%'")).toEqual([]);
    } finally {
      reader.close();
    }
  });

  it("still refuses SQL naming a denylisted table, even though the fixture carries one", () => {
    withDb(v2Path, (db) => {
      for (const table of DENYLISTED_TABLES) expect(() => query(db, `SELECT * FROM ${table}`)).toThrow(/denylisted/);
    });
  });
});

describe("v2-only database", () => {
  it("lists every session_v2 session with transcript-derived counts and stored usage", () => {
    const sessions = withDb(v2Path, (db) => listSessions(db, {}, PRICING));
    expect(sessions.data.map((s) => s.id).sort()).toEqual([V2_CHILD_SESSION, V2_MAIN_SESSION, V2_UNTITLED_SESSION].sort());
    const main = sessions.data.find((s) => s.id === V2_MAIN_SESSION)!;
    // user + synthetic + compaction marker; 6 assistant rows + the compaction summary.
    expect(main.messageCounts).toEqual({ user: 3, assistant: 7 });
    expect(main.toolCallCount).toBe(8);
    expect(main.errorCount).toBe(1);
    expect(main.tokens).toEqual(V2_MAIN_TOKENS);
    expect(main.hasReasoning).toBe(true);
    expect(main.hasCompaction).toBe(true);
    expect(main.usesSubagent).toBe(true);
    expect(main.cost.priced).toBe(true);
    expect(main.model).toEqual(V2_MODEL);
    expect(sessions.data.find((s) => s.id === V2_CHILD_SESSION)?.parentId).toBe(V2_MAIN_SESSION);
  });

  it("falls back from a NULL v2 title to the first user text, then the slug", () => {
    const sessions = withDb(v2Path, (db) => listSessions(db)).data;
    expect(sessions.find((s) => s.id === V2_CHILD_SESSION)?.title).toBe("Look for TS2345");
    expect(sessions.find((s) => s.id === V2_UNTITLED_SESSION)?.title).toBe("ses-v2-untitled-slug");
  });

  it("replays in seq order with tool boundaries, step usage, and every lifecycle record", () => {
    const replay = withDb(v2Path, (db) => getReplay(db, V2_MAIN_SESSION, [], PRICING));
    const turns = replay.data!.turns;
    expect(turns.map((t) => t.messageId)).toEqual([
      "msg_m00", "msg_m01", "msg_m02", "msg_m03", "msg_m04", "msg_m05", "msg_m06", "msg_m07", "msg_m08",
      "msg_m09", "msg_m09-summary", "msg_m10", "msg_m11", "msg_m12", "msg_m13",
    ]);
    expect(turns.map((t) => t.role)).toEqual([
      "user", "assistant", "assistant", "assistant", "assistant", "assistant", "event", "event", "event",
      "user", "assistant", "event", "user", "assistant", "event",
    ]);

    const first = turns[1]!;
    expect(first.parts.map((p) => p.data.type)).toEqual(["step-start", "reasoning", "tool", "step-finish"]);
    expect(first.agent).toBe("build");
    expect(first.timeCompleted).toBe(first.timeCreated + 5);
    expect(first.tokens).toEqual({ input: 1_000, output: 50, reasoning: 20, cacheRead: 200, cacheWrite: 0 });
    expect(first.cost.priced).toBe(true);
    const shell = first.parts[2]!.data;
    expect(shell).toMatchObject({ type: "tool", tool: "shell", callId: "call_s1", status: "completed", input: { command: SHELL_RETRY_COMMAND }, output: "error TS2345" });
    if (shell.type === "tool") expect(shell.timeEnd! - shell.timeStart!).toBe(2);

    const failedRead = turns[4]!.parts[1]!.data;
    expect(failedRead).toMatchObject({ type: "tool", tool: "read", status: "error", output: "File not found" });

    expect(turns[5]!.parts.map((p) => p.data.type)).toEqual(["step-start", "tool", "tool", "text", "patch", "step-finish"]);
    expect(turns[5]!.parts[4]!.data).toEqual({ type: "patch", hash: "9f3c0a1e2d4b5c6a7e8f9a0b1c2d3e4f5a6b7c8d", files: ["src/a.ts"] });
    expect(turns[2]!.parts.map((p) => p.data.type)).toEqual(["step-start", "tool", "step-finish"]);

    const compaction = turns[9]!.parts[0]!.data;
    expect(compaction).toEqual({ type: "compaction", auto: true, overflow: null, tailStartId: null });
    expect(turns[10]!.parts.map((p) => p.data.type)).toEqual(["text", "step-finish"]);
    expect(turns[10]!.tokens).toEqual({ input: 400, output: 30, reasoning: 0, cacheRead: 0, cacheWrite: 0 });

    const inFlight = turns[13]!;
    expect(inFlight.timeCompleted).toBeNull();
    expect(inFlight.tokens).toBeNull();
    expect(inFlight.parts.map((p) => p.data.type)).toEqual(["step-start", "tool"]);
    expect(inFlight.parts[1]!.data).toMatchObject({ status: "pending", input: "{\"comm" });

    const events = turns.filter((t) => t.role === "event").map((t) => t.parts[0]!.data);
    expect(events).toEqual([
      { type: "session-event", kind: "idle", rawKind: "idle", summary: "Session idle · succeeded", detail: null, outcome: "succeeded", exitCode: null },
      { type: "session-event", kind: "system", rawKind: "system", summary: "Instructions reloaded", detail: "Instructions changed on disk.", outcome: null, exitCode: null },
      { type: "session-event", kind: "agent-switched", rawKind: "agent-switched", summary: "Agent switched to plan (from build)", detail: null, outcome: null, exitCode: null },
      { type: "session-event", kind: "unknown", rawKind: "checkpoint-v9", summary: "Unrecognised session record: checkpoint-v9", detail: null, outcome: null, exitCode: null },
      { type: "session-event", kind: "idle", rawKind: "idle", summary: "Session idle · failed", detail: "Rate limited", outcome: "failed", exitCode: null },
    ]);
    expect(replay.warnings).toContainEqual(expect.objectContaining({ code: "unknown-session-event", count: 1 }));
    expect(replay.warnings.map((w) => w.code)).not.toContain("unknown-message-role");
    expect(replay.warnings.map((w) => w.code)).not.toContain("malformed-compaction");

    // The running total walks step-finish parts only, so events add nothing.
    expect(replay.data!.tokenAccumulation.at(-1)!.tokens).toEqual({ input: 5_400, output: 280, reasoning: 100, cacheRead: 1_000, cacheWrite: 0 });
    expect(replay.data!.childIds).toEqual([V2_CHILD_SESSION]);
  });

  it("builds the subagent tree from session_v2.parent_id", () => {
    const tree = withDb(v2Path, (db) => subagentTree(db, V2_MAIN_SESSION)).data!;
    expect(tree.children.map((c) => c.sessionId)).toEqual([V2_CHILD_SESSION]);
    expect(tree.toolCallCount).toBe(8);
    expect(tree.children[0]!.toolCallCount).toBe(1);
  });

  it("reports a shell command retried with a non-zero exit as an error-retry loop", () => {
    const loops = withDb(v2Path, (db) => detectLoops(db, {}, PRICING));
    const retry = loops.data.incidents.find((i) => i.kind === "error-retry");
    expect(retry).toMatchObject({ sessionId: V2_MAIN_SESSION, tool: "shell", calls: 3, wastedCalls: 2 });
    expect(loops.data.incidents).toHaveLength(1);
    // The streaming call recorded only a partial-JSON string, so it cannot be compared.
    expect(loops.data.coverage.unsignaturable).toBe(1);
  });

  it("derives todos from the last todowrite call, since 2.x has no todo table", () => {
    const todos = withDb(v2Path, (db) => readTodos(db)).data;
    expect(todos.sessions).toHaveLength(1);
    expect(todos.sessions[0]!.todos.map((t) => [t.content, t.status, t.priority, t.position])).toEqual([
      ["Fix types", "completed", "high", 0],
      ["Run tests", "pending", "medium", 1],
    ]);
    expect(todos.rollup).toEqual({ pending: 1, inProgress: 0, completed: 1, unknown: 0 });
  });

  it("categorises the 2.x tool names and finds files named by `path`", () => {
    const tools = withDb(v2Path, (db) => toolUsage(db)).data;
    const byName = new Map(tools.map((t) => [t.tool, t]));
    expect(byName.get("shell")?.category).toBe("exec");
    expect(byName.get("subagent")?.category).toBe("delegation");
    expect(withDb(v2Path, (db) => toolUsage(db)).warnings.map((w) => w.code)).not.toContain("unknown-tool");
    const files = withDb(v2Path, (db) => fileChanges(db, V2_MAIN_SESSION)).data;
    expect(files.map((f) => f.filePath)).toEqual(["/w/alpha/src/a.ts"]);
    expect(withDb(v2Path, (db) => featureAdoption(db)).data).toBeDefined();
    expect(withDb(v2Path, (db) => skillUsage(db)).data).toEqual([]);
  });

  it("prices per assistant step and buckets agents from the step records", () => {
    const costs = withDb(v2Path, (db) => costBreakdown(db, PRICING));
    // 6 priced steps of STEP_TOKENS (5 main + 1 child) plus the compaction request.
    const expected = (6 * (1_000 + 50 + 200) + 400 + 30) / 1_000_000;
    expect(costs.totalCost.priced).toBe(true);
    expect(costs.totalCost.amount).toBeCloseTo(expected, 12);
    const agents = withDb(v2Path, (db) => agentUsage(db, {}, PRICING)).data;
    expect(agents.map((a) => a.agent).sort()).toEqual(["build", "compaction", "explore", "plan", "unknown"].sort());
    const events = withDb(v2Path, (db) => agentSwitchEvents(db)).data;
    expect(events).toEqual([expect.objectContaining({ sessionId: V2_MAIN_SESSION, agent: "plan" })]);
  });

  it("serves project and overview aggregates without SQL errors", () => {
    withDb(v2Path, (db) => {
      expect(listProjects(db).data.map((p) => p.id)).toEqual(["prj_alpha"]);
      expect(getOverviewStats(db).data.totalSessions).toBe(3);
      expect(loopDiagnostics(db).data).toBeDefined();
    });
  });
});

describe("mixed v1/v2 database", () => {
  it("counts a migrated session once and keeps a not-yet-migrated legacy session", () => {
    const sessions = withDb(mixedPath, (db) => listSessions(db, {}, PRICING)).data;
    const ids = sessions.map((s) => s.id);
    expect(ids).toHaveLength(new Set(ids).size);
    expect(ids.sort()).toEqual([LEGACY_ONLY_SESSION, MIGRATED_SESSION, V2_CHILD_SESSION, V2_MAIN_SESSION, V2_UNTITLED_SESSION].sort());
    const migrated = sessions.find((s) => s.id === MIGRATED_SESSION)!;
    // Legacy rows win; the migration's synthesised system row is ignored; the post-upgrade turn is kept.
    expect(migrated.messageCounts).toEqual({ user: 2, assistant: 2 });
    expect(migrated.toolCallCount).toBe(1);
    expect(migrated.tokens).toEqual(MIGRATED_V2_TOKENS);
    expect(sessions.find((s) => s.id === LEGACY_ONLY_SESSION)?.messageCounts).toEqual({ user: 1, assistant: 1 });
  });

  it("replays legacy parts followed by the 2.x continuation, without the migrated duplicates", () => {
    const turns = withDb(mixedPath, (db) => getReplay(db, MIGRATED_SESSION)).data!.turns;
    expect(turns.map((t) => t.messageId)).toEqual(["msg_old_u1", "msg_old_a1", "msg_new_u2", "msg_new_a2"]);
    expect(turns[1]!.parts.map((p) => p.id)).toEqual(["prt_old_2", "prt_old_3", "prt_old_4"]);
    expect(turns[3]!.parts.map((p) => p.data.type)).toEqual(["step-start", "text", "step-finish"]);
  });

  it("does not double-count tokens or cost across the two generations", () => {
    const costs = withDb(mixedPath, (db) => costBreakdown(db, PRICING));
    const v2Only = withDb(v2Path, (db) => costBreakdown(db, PRICING));
    // Two legacy assistant messages (one per legacy session) + one continuation step.
    const legacyExtra = (2 * (500 + 20) + (1_000 + 50 + 200)) / 1_000_000;
    expect(costs.totalCost.amount).toBeCloseTo(v2Only.totalCost.amount + legacyExtra, 12);
    const migratedCost = costs.bySession.find((s) => s.sessionId === MIGRATED_SESSION)!.cost;
    expect(migratedCost.amount).toBeCloseTo((500 + 20 + 1_000 + 50 + 200) / 1_000_000, 12);
  });

  it("keeps legacy todos and still derives 2.x todos for native sessions", () => {
    const todos = withDb(mixedPath, (db) => readTodos(db)).data;
    expect(todos.sessions.map((s) => [s.sessionId, s.todos.length]).sort()).toEqual([[MIGRATED_SESSION, 1], [V2_MAIN_SESSION, 2]]);
  });

  it("finds the v2 loop in a mixed database exactly once", () => {
    const loops = withDb(mixedPath, (db) => detectLoops(db, {}, PRICING)).data;
    expect(loops.incidents.filter((i) => i.kind === "error-retry")).toHaveLength(1);
  });
});

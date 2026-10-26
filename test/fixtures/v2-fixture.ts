import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * Deterministic opencode 2.x fixtures (data-model §8).
 *
 * The DDL below is copied verbatim from a database created by opencode 2.1.4
 * itself in an empty data directory — not inferred from the 1.x fixture. The
 * `session_message.data` payloads use only keys observed on a real 2.1.4
 * database by the values-free shape probe recorded in §8, plus the upstream
 * `session-message.ts` schema for the lifecycle kinds that probe did not see
 * (`agent-switched`). Every payload is hand-written so tests can assert exact
 * numbers; nothing here is generated from, or compared against, a real DB.
 *
 * `buildV2Fixture` is a pure 2.x database. `buildMixedFixture` adds the legacy
 * 1.x tables the way an upgrade leaves them: a migrated session present in
 * both generations under the same ids, a migration-synthesised row inside it
 * that must not be counted, a continuation recorded only in 2.x, and a legacy
 * session the migration has not copied yet.
 */

const V2_SCHEMA_SQL = `
CREATE TABLE \`project\` (
  \`id\` text PRIMARY KEY, \`worktree\` text NOT NULL, \`vcs\` text, \`name\` text, \`icon_url\` text,
  \`icon_url_override\` text, \`icon_color\` text, \`time_created\` integer NOT NULL, \`time_updated\` integer NOT NULL,
  \`time_initialized\` integer, \`time_active\` integer DEFAULT 0 NOT NULL, \`time_archived\` integer,
  \`sandboxes\` text NOT NULL, \`commands\` text
);
CREATE TABLE \`session_v2\` (
  \`id\` text PRIMARY KEY, \`project_id\` text NOT NULL, \`workspace_id\` text, \`parent_id\` text, \`fork_session_id\` text,
  \`fork_boundary\` text, \`slug\` text NOT NULL, \`directory\` text NOT NULL, \`path\` text, \`title\` text,
  \`version\` text NOT NULL, \`share_url\` text, \`summary_additions\` integer, \`summary_deletions\` integer,
  \`summary_files\` integer, \`summary_diffs\` text, \`metadata\` text, \`cost\` real DEFAULT 0 NOT NULL,
  \`tokens_input\` integer DEFAULT 0 NOT NULL, \`tokens_output\` integer DEFAULT 0 NOT NULL,
  \`tokens_reasoning\` integer DEFAULT 0 NOT NULL, \`tokens_cache_read\` integer DEFAULT 0 NOT NULL,
  \`tokens_cache_write\` integer DEFAULT 0 NOT NULL, \`revert\` text, \`permission\` text, \`agent\` text, \`model\` text,
  \`time_created\` integer NOT NULL, \`time_updated\` integer NOT NULL, \`time_idle\` integer, \`time_viewed\` integer,
  \`idle_outcome\` text, \`time_compacting\` integer, \`time_archived\` integer, \`time_suspended\` integer,
  \`resume_attempts\` integer DEFAULT 0 NOT NULL,
  CONSTRAINT \`fk_session_v2_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
);
CREATE TABLE \`session_message\` (
  \`id\` text PRIMARY KEY, \`session_id\` text NOT NULL, \`type\` text NOT NULL, \`seq\` integer NOT NULL,
  \`time_created\` integer NOT NULL, \`time_updated\` integer NOT NULL, \`data\` text NOT NULL,
  CONSTRAINT \`fk_session_message_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
);
CREATE TABLE \`workspace\` (
  \`id\` text PRIMARY KEY, \`provider\` text NOT NULL, \`binding\` text, \`created_at\` integer NOT NULL, \`last_used_at\` integer NOT NULL
);
CREATE TABLE \`account\` (\`id\` text PRIMARY KEY, \`access_token\` text);
CREATE TABLE \`credential\` (\`id\` text PRIMARY KEY, \`value\` text);
CREATE UNIQUE INDEX \`session_message_session_seq_idx\` ON \`session_message\` (\`session_id\`,\`seq\`);
CREATE INDEX \`session_message_session_type_seq_idx\` ON \`session_message\` (\`session_id\`,\`type\`,\`seq\`);
CREATE INDEX \`session_v2_parent_idx\` ON \`session_v2\` (\`parent_id\`);
`;

const LEGACY_SCHEMA_SQL = `
CREATE TABLE session (
  id TEXT PRIMARY KEY, project_id TEXT, workspace_id TEXT, parent_id TEXT, slug TEXT, directory TEXT, path TEXT,
  title TEXT, version TEXT, share_url TEXT, summary_additions INTEGER, summary_deletions INTEGER, summary_files INTEGER,
  summary_diffs TEXT, metadata TEXT, cost REAL, tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER,
  tokens_cache_read INTEGER, tokens_cache_write INTEGER, revert TEXT, permission TEXT, agent TEXT, model TEXT,
  time_created INTEGER, time_updated INTEGER, time_compacting INTEGER, time_archived INTEGER
);
CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
CREATE TABLE todo (session_id TEXT, content TEXT, status TEXT, priority TEXT, position INTEGER, time_created INTEGER, time_updated INTEGER);
`;

export const V2_T0 = 1_790_000_000_000;
export const V2_PROJECT_ID = "prj_alpha";
export const V2_MODEL = { id: "m-large", providerID: "acme", variant: "default" } as const;
export const V2_MAIN_SESSION = "ses_v2_main";
export const V2_CHILD_SESSION = "ses_v2_child";
export const V2_UNTITLED_SESSION = "ses_v2_untitled";
export const MIGRATED_SESSION = "ses_old";
export const LEGACY_ONLY_SESSION = "ses_legacy_only";
export const SHELL_RETRY_COMMAND = "pnpm build";

const STEP_TOKENS = { input: 1_000, output: 50, reasoning: 20, cache: { read: 200, write: 0 } } as const;
const STEP_COST = 0.002;

interface Row { id: string; type: string; time: number; data: Record<string, unknown> }

function assistant(id: string, time: number, content: unknown[], extra: Record<string, unknown> = {}): Row {
  return {
    id, type: "assistant", time,
    data: {
      agent: "build", model: V2_MODEL, content, cost: STEP_COST, tokens: STEP_TOKENS, finish: "tool-calls",
      time: { created: time, completed: time + 5 }, ...extra,
    },
  };
}

function shellCall(id: string, time: number, exit: number): Record<string, unknown> {
  return {
    type: "tool", id, name: "shell", executed: false,
    state: { status: "completed", input: { command: SHELL_RETRY_COMMAND }, content: [{ type: "text", text: exit === 0 ? "ok" : "error TS2345" }], metadata: { exit, status: "completed", truncated: false } },
    time: { created: time, ran: time + 1, completed: time + 3 },
  };
}

/** The main 2.x session, in `seq` order. Ids are `msg_` + an ascending suffix, as upstream's are. */
function mainTranscript(): Row[] {
  const t = V2_T0;
  return [
    { id: "msg_m00", type: "user", time: t, data: { text: "Fix the failing build", time: { created: t } } },
    assistant("msg_m01", t + 10, [{ type: "reasoning", text: "Run the build first.", time: { created: t + 10, completed: t + 11 } }, shellCall("call_s1", t + 12, 1)]),
    // A snapshot with no file changes (the common case on real data) yields no patch part.
    assistant("msg_m02", t + 20, [shellCall("call_s2", t + 21, 1)], { snapshot: { start: "4b825dc642cb6eb9a060e54bf8d69288fbee4904", end: "4b825dc642cb6eb9a060e54bf8d69288fbee4904" } }),
    assistant("msg_m03", t + 30, [shellCall("call_s3", t + 31, 1)]),
    assistant("msg_m04", t + 40, [
      { type: "tool", id: "call_r1", name: "read", state: { status: "error", input: { path: "/w/alpha/src/missing.ts" }, error: { type: "tool.execution", message: "File not found" } }, time: { created: t + 41, completed: t + 42 } },
      { type: "tool", id: "call_sub", name: "subagent", executed: false, state: { status: "completed", input: { agent: "explore", description: "Find the type error", prompt: "Look for TS2345", background: false }, content: [{ type: "text", text: "Found it" }], metadata: { sessionID: V2_CHILD_SESSION, status: "completed", truncated: false } }, time: { created: t + 43, ran: t + 43, completed: t + 48 } },
    ]),
    assistant("msg_m05", t + 50, [
      { type: "tool", id: "call_todo", name: "todowrite", state: { status: "completed", input: { todos: [{ content: "Fix types", status: "completed", priority: "high" }, { content: "Run tests", status: "pending", priority: "medium" }] }, content: [{ type: "text", text: "2 todos" }], metadata: { todos: [{ content: "Fix types", status: "completed", priority: "high" }, { content: "Run tests", status: "pending", priority: "medium" }], truncated: false } }, time: { created: t + 51, completed: t + 52 } },
      { type: "tool", id: "call_w1", name: "write", executed: false, state: { status: "completed", input: { path: "/w/alpha/src/a.ts", content: "export const a = 1;\n" }, content: [{ type: "text", text: "Wrote file" }], metadata: { truncated: false } }, time: { created: t + 53, ran: t + 53, completed: t + 54 } },
      { type: "text", text: "Fixed the type error." },
    ], { finish: "stop", snapshot: { start: "4b825dc642cb6eb9a060e54bf8d69288fbee4904", end: "9f3c0a1e2d4b5c6a7e8f9a0b1c2d3e4f5a6b7c8d", files: ["src/a.ts"] } }),
    { id: "msg_m06", type: "idle", time: t + 60, data: { outcome: "succeeded", time: { created: t + 60 } } },
    { id: "msg_m07", type: "system", time: t + 70, data: { text: "Instructions changed on disk.", description: "Instructions reloaded", time: { created: t + 70 } } },
    { id: "msg_m08", type: "agent-switched", time: t + 80, data: { agent: "plan", previous: "build", time: { created: t + 80 } } },
    { id: "msg_m09", type: "compaction", time: t + 90, data: { reason: "auto", status: "completed", summary: "Fixed TS2345 in a.ts.", recent: "msg_m05", model: V2_MODEL, cost: 0.001, tokens: { input: 400, output: 30, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: t + 90 } } },
    { id: "msg_m10", type: "checkpoint-v9", time: t + 100, data: { time: { created: t + 100 } } },
    { id: "msg_m11", type: "synthetic", time: t + 110, data: { text: "Continue if you have next steps.", time: { created: t + 110 } } },
    // In flight: a streaming tool records its input as a partial JSON string, and no usage yet.
    { id: "msg_m12", type: "assistant", time: t + 120, data: { agent: "plan", model: V2_MODEL, content: [{ type: "tool", id: "call_s4", name: "shell", state: { status: "streaming", input: "{\"comm" }, time: { created: t + 121 } }], time: { created: t + 120 } } },
    { id: "msg_m13", type: "idle", time: t + 130, data: { outcome: "failed", error: { type: "provider.rate-limit", message: "Rate limited" }, time: { created: t + 130 } } },
  ];
}

function childTranscript(): Row[] {
  const t = V2_T0 + 43;
  return [
    { id: "msg_c00", type: "user", time: t, data: { text: "Look for TS2345", time: { created: t } } },
    {
      id: "msg_c01", type: "assistant", time: t + 1,
      data: { agent: "explore", model: V2_MODEL, content: [{ type: "tool", id: "call_g1", name: "glob", state: { status: "completed", input: { pattern: "**/*.ts" }, content: [{ type: "text", text: "a.ts" }], metadata: { count: 1, truncated: false } }, time: { created: t + 2, completed: t + 3 } }, { type: "text", text: "a.ts line 3" }], cost: STEP_COST, tokens: STEP_TOKENS, finish: "stop", time: { created: t + 1, completed: t + 4 } },
    },
  ];
}

/** Session-level usage as opencode 2.x stores it on `session_v2`. Each assistant step contributes STEP_TOKENS. */
export const V2_MAIN_STEPS = 5;
export const V2_MAIN_TOKENS = { input: 1_000 * V2_MAIN_STEPS + 400, output: 50 * V2_MAIN_STEPS + 30, reasoning: 20 * V2_MAIN_STEPS, cacheRead: 200 * V2_MAIN_STEPS, cacheWrite: 0 };

interface SessionSpec { id: string; parentId?: string; title: string | null; agent: string | null; time: number; tokens?: typeof V2_MAIN_TOKENS; version?: string }

function insertSessionV2(db: DatabaseSync, s: SessionSpec): void {
  const tokens = s.tokens ?? { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  db.prepare(`INSERT INTO session_v2 (id, project_id, parent_id, slug, directory, title, version, cost, tokens_input, tokens_output,
    tokens_reasoning, tokens_cache_read, tokens_cache_write, agent, model, time_created, time_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    s.id, V2_PROJECT_ID, s.parentId ?? null, `${s.id.replace(/_/g, "-")}-slug`, "/w/alpha", s.title, s.version ?? "2.1.4",
    tokens.input, tokens.output, tokens.reasoning, tokens.cacheRead, tokens.cacheWrite, s.agent, JSON.stringify(V2_MODEL), s.time, s.time + 200,
  );
}

function insertTranscript(db: DatabaseSync, sessionId: string, rows: Row[], firstSeq = 0): void {
  const stmt = db.prepare("INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)");
  rows.forEach((row, index) => stmt.run(row.id, sessionId, row.type, firstSeq + index, row.time, row.time, JSON.stringify(row.data)));
}

function populateV2(db: DatabaseSync): void {
  db.prepare("INSERT INTO project (id, worktree, vcs, name, time_created, time_updated, sandboxes) VALUES (?, ?, 'git', NULL, ?, ?, '[]')").run(V2_PROJECT_ID, "/w/alpha", V2_T0, V2_T0);
  db.prepare("INSERT INTO account (id, access_token) VALUES ('acc_1', 'fixture-secret-must-never-be-read')").run();
  insertSessionV2(db, { id: V2_MAIN_SESSION, title: "Fix the build", agent: "build", time: V2_T0, tokens: V2_MAIN_TOKENS });
  insertSessionV2(db, { id: V2_CHILD_SESSION, parentId: V2_MAIN_SESSION, title: null, agent: "explore", time: V2_T0 + 43 });
  insertSessionV2(db, { id: V2_UNTITLED_SESSION, title: null, agent: null, time: V2_T0 + 500 });
  insertTranscript(db, V2_MAIN_SESSION, mainTranscript());
  insertTranscript(db, V2_CHILD_SESSION, childTranscript());
}

function create(path: string, sql: string): DatabaseSync {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(`${path}${suffix}`, { force: true });
  const db = new DatabaseSync(path);
  db.exec(sql);
  return db;
}

/** A database exactly as opencode 2.x creates it — no legacy tables. */
export function buildV2Fixture(path: string): void {
  const db = create(path, V2_SCHEMA_SQL);
  db.exec("BEGIN");
  populateV2(db);
  db.exec("COMMIT");
  db.close();
}

export const MIGRATED_T0 = V2_T0 - 86_400_000;
export const MIGRATED_V2_TOKENS = { input: 500 + 1_000, output: 20 + 50, reasoning: 20, cacheRead: 200, cacheWrite: 0 };
const LEGACY_TOKENS = { input: 500, output: 20, reasoning: 0, cache: { read: 0, write: 0 } };

/** A 1.x database upgraded to 2.x: both generations, overlapping by id. */
export function buildMixedFixture(path: string): void {
  const db = create(path, V2_SCHEMA_SQL + LEGACY_SCHEMA_SQL);
  db.exec("BEGIN");
  populateV2(db);
  const t = MIGRATED_T0;
  const legacySession = db.prepare(`INSERT INTO session (id, project_id, slug, directory, title, version, cost, tokens_input, tokens_output,
    tokens_reasoning, tokens_cache_read, tokens_cache_write, agent, model, time_created, time_updated)
    VALUES (?, ?, ?, '/w/alpha', ?, '1.18.32', 0, ?, ?, 0, 0, 0, 'build', ?, ?, ?)`);
  legacySession.run(MIGRATED_SESSION, V2_PROJECT_ID, "old-otter", "Legacy work", 500, 20, JSON.stringify(V2_MODEL), t, t + 20);
  legacySession.run(LEGACY_ONLY_SESSION, V2_PROJECT_ID, "lonely-lynx", "Not migrated yet", 500, 20, JSON.stringify(V2_MODEL), t - 5_000, t - 4_000);
  // The migration copies the session row into session_v2 under the same id; the
  // post-upgrade continuation then adds one more step to the 2.x row's usage only.
  insertSessionV2(db, { id: MIGRATED_SESSION, title: "Legacy work", agent: "build", time: t, version: "1.18.32", tokens: MIGRATED_V2_TOKENS });

  const message = db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)");
  const part = db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)");
  const legacyAssistant = (time: number) => ({ role: "assistant", agent: "build", mode: "build", modelID: V2_MODEL.id, providerID: V2_MODEL.providerID, cost: 0, tokens: { total: 520, ...LEGACY_TOKENS }, time: { created: time, completed: time + 5 }, finish: "stop", parentID: "msg_old_u1" });
  message.run("msg_old_u1", MIGRATED_SESSION, t, t, JSON.stringify({ role: "user", agent: "build", time: { created: t }, model: { providerID: V2_MODEL.providerID, modelID: V2_MODEL.id } }));
  part.run("prt_old_1", "msg_old_u1", MIGRATED_SESSION, t, t, JSON.stringify({ type: "text", text: "Legacy question" }));
  message.run("msg_old_a1", MIGRATED_SESSION, t + 10, t + 10, JSON.stringify(legacyAssistant(t + 10)));
  part.run("prt_old_2", "msg_old_a1", MIGRATED_SESSION, t + 10, t + 10, JSON.stringify({ type: "step-start" }));
  part.run("prt_old_3", "msg_old_a1", MIGRATED_SESSION, t + 11, t + 11, JSON.stringify({ type: "tool", tool: "read", callID: "c_old", state: { status: "completed", input: { filePath: "/w/alpha/README.md" }, output: "…", metadata: { truncated: false }, title: "README.md", time: { start: t + 11, end: t + 12 } } }));
  part.run("prt_old_4", "msg_old_a1", MIGRATED_SESSION, t + 13, t + 13, JSON.stringify({ type: "step-finish", reason: "stop", cost: 0, tokens: { total: 520, ...LEGACY_TOKENS } }));
  db.prepare("INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated) VALUES (?, 'Legacy todo', 'in_progress', 'low', 0, ?, ?)").run(MIGRATED_SESSION, t, t);
  message.run("msg_lo_u1", LEGACY_ONLY_SESSION, t - 5_000, t - 5_000, JSON.stringify({ role: "user", agent: "build", time: { created: t - 5_000 } }));
  message.run("msg_lo_a1", LEGACY_ONLY_SESSION, t - 4_990, t - 4_990, JSON.stringify({ ...legacyAssistant(t - 4_990), parentID: "msg_lo_u1" }));
  part.run("prt_lo_1", "msg_lo_a1", LEGACY_ONLY_SESSION, t - 4_990, t - 4_990, JSON.stringify({ type: "step-finish", reason: "stop", cost: 0, tokens: { total: 520, ...LEGACY_TOKENS } }));

  // The migrated copies of the legacy messages (same ids), a row the migration
  // synthesised inside the legacy history (must be ignored), then a turn the
  // user added after upgrading (exists only in 2.x, must be included).
  insertTranscript(db, MIGRATED_SESSION, [
    { id: "msg_old_u1", type: "user", time: t, data: { text: "Legacy question", time: { created: t } } },
    assistant("msg_old_a1", t + 10, [{ type: "tool", id: "c_old", name: "read", state: { status: "completed", input: { filePath: "/w/alpha/README.md" }, content: [{ type: "text", text: "…" }] }, time: { created: t + 11, completed: t + 12 } }], { tokens: LEGACY_TOKENS, cost: 0, finish: "stop" }),
    { id: "msg_old_sys", type: "system", time: t + 10, data: { text: "Migrated context", time: { created: t + 10 } } },
    { id: "msg_new_u2", type: "user", time: t + 1_000, data: { text: "Picking this up after the upgrade", time: { created: t + 1_000 } } },
    assistant("msg_new_a2", t + 1_010, [{ type: "text", text: "Continuing." }], { finish: "stop" }),
  ]);
  db.exec("COMMIT");
  db.close();
}

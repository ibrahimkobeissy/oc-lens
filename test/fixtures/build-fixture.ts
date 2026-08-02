import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { FIXTURE_SCHEMA_SQL } from "./schema";
import { createPrng, randInt, randChoice, randBool, type Rng } from "./prng";
import {
  FIXTURE_SEED,
  LONG_SESSION_MESSAGE_COUNT,
  CORE_TOOLS,
  MCP_TOOL_NAMES,
  SKILL_NAMES,
  PROVIDER_MODELS,
  AGENTS,
  GLOBAL_PROJECT_ID,
} from "./manifest";
import { POPULATED_DB_PATH, EMPTY_DB_PATH } from "./paths";

const DAY_MS = 86_400_000;
/** Arbitrary fixed epoch (2025-06-15T00:00:00Z, computed as a literal — never `Date.now()`), spread ~14 months forward. */
const EPOCH_START_MS = 1_750_000_000_000;
const SPAN_DAYS = 425;

const ADJECTIVES = ["crisp", "quiet", "amber", "lucid", "brisk", "dusky", "vivid", "mellow", "spry", "faint"];
const ANIMALS = ["otter", "heron", "lynx", "finch", "gecko", "marten", "vole", "swift", "wren", "ibis"];

const ERROR_MESSAGES = [
  "ENOENT: no such file or directory",
  "Permission denied",
  "Command timed out after 30000ms",
  "SyntaxError: Unexpected token",
  "grep: pattern not found",
  "fetch failed: getaddrinfo ENOTFOUND",
];

interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

function zeroUsage(): TokenUsage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

function randUsage(rng: Rng): TokenUsage {
  return {
    input: randInt(rng, 200, 3000),
    output: randInt(rng, 5, 500),
    reasoning: randBool(rng, 0.4) ? randInt(rng, 10, 200) : 0,
    cacheRead: randBool(rng, 0.5) ? randInt(rng, 0, 2000) : 0,
    cacheWrite: randBool(rng, 0.3) ? randInt(rng, 0, 500) : 0,
  };
}

function slug(rng: Rng): string {
  return `${randChoice(rng, ADJECTIVES)}-${randChoice(rng, ANIMALS)}`;
}

interface ProjectSeed {
  id: string;
  worktree: string;
  name: string | null;
}

const PROJECT_SEEDS: ProjectSeed[] = [
  { id: GLOBAL_PROJECT_ID, worktree: "/", name: null },
  { id: "proj_web", worktree: "/home/dev/web-app", name: "web-app" },
  { id: "proj_api", worktree: "/home/dev/api-service", name: "api-service" },
  { id: "proj_infra", worktree: "/home/dev/infra", name: "infra" },
  { id: "proj_docs", worktree: "/home/dev/docs-site", name: "docs-site" },
  { id: "proj_mobile", worktree: "/home/dev/mobile-app", name: "mobile-app" },
];

interface GeneratedTool {
  tool: string;
  callId: string;
  status: "completed" | "error" | "pending" | "running";
  input: Record<string, unknown>;
  output: string | null;
  title: string;
  timeStart: number | null;
  timeEnd: number | null;
}

interface Counters {
  messages: number;
  parts: number;
  todos: number;
  sessionMessages: number;
  errorToolCalls: number;
  pendingEmitted: boolean;
  runningEmitted: boolean;
  coreToolCursor: number;
  mcpToolCursor: number;
  skillCursor: number;
}

function nextToolCall(rng: Rng, counters: Counters, tStart: number): GeneratedTool {
  let tool: string;
  // Guarantee coverage of every core tool and every MCP tool name before falling back to random picks.
  if (counters.coreToolCursor < CORE_TOOLS.length) {
    tool = CORE_TOOLS[counters.coreToolCursor] as string;
    counters.coreToolCursor++;
  } else if (counters.mcpToolCursor < MCP_TOOL_NAMES.length) {
    tool = MCP_TOOL_NAMES[counters.mcpToolCursor] as string;
    counters.mcpToolCursor++;
  } else {
    const pool: readonly string[] = randBool(rng, 0.85) ? CORE_TOOLS : MCP_TOOL_NAMES;
    tool = randChoice(rng, pool);
  }

  const callId = `call_${counters.parts.toString(36).padStart(6, "0")}`;
  let input: Record<string, unknown> = {};
  let title = tool;

  if (tool === "skill") {
    const skillName = SKILL_NAMES[counters.skillCursor % SKILL_NAMES.length] as string;
    counters.skillCursor++;
    input = { name: skillName };
    title = `skill:${skillName}`;
  } else if (tool === "write" || tool === "edit") {
    const filePath = `/tmp/oc-lens-fixture/file-${counters.parts}.ts`;
    input = { filePath, content: "// fixture content" };
    title = filePath;
  } else if (tool === "read") {
    const filePath = `/tmp/oc-lens-fixture/file-${counters.parts}.ts`;
    input = { filePath };
    title = filePath;
  } else if (tool === "bash") {
    input = { command: "echo fixture" };
    title = "echo fixture";
  } else if (tool === "webfetch") {
    input = { url: "https://example.com" };
    title = "https://example.com";
  }

  let status: GeneratedTool["status"];
  if (!counters.pendingEmitted) {
    status = "pending";
    counters.pendingEmitted = true;
  } else if (!counters.runningEmitted) {
    status = "running";
    counters.runningEmitted = true;
  } else if (randBool(rng, 0.12) || counters.errorToolCalls < 40) {
    status = "error";
    counters.errorToolCalls++;
  } else {
    status = "completed";
  }

  const duration = randInt(rng, 5, 4000);
  const timeStart = status === "pending" ? null : tStart;
  const timeEnd = status === "completed" || status === "error" ? tStart + duration : null;
  const output = status === "error" ? randChoice(rng, ERROR_MESSAGES) : status === "completed" ? "ok" : null;

  return { tool, callId, status, input, output, title, timeStart, timeEnd };
}

function main(): void {
  mkdirSync(path.dirname(POPULATED_DB_PATH), { recursive: true });
  for (const p of [POPULATED_DB_PATH, EMPTY_DB_PATH]) {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(p + suffix)) rmSync(p + suffix);
    }
  }

  buildEmptyDb();
  buildPopulatedDb();
}

function buildEmptyDb(): void {
  const db = new DatabaseSync(EMPTY_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(FIXTURE_SCHEMA_SQL);
  db.close();
}

function buildPopulatedDb(): void {
  const rng = createPrng(FIXTURE_SEED);
  const db = new DatabaseSync(POPULATED_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(FIXTURE_SCHEMA_SQL);
  db.exec("BEGIN;");

  const counters: Counters = {
    messages: 0,
    parts: 0,
    todos: 0,
    sessionMessages: 0,
    errorToolCalls: 0,
    pendingEmitted: false,
    runningEmitted: false,
    coreToolCursor: 0,
    mcpToolCursor: 0,
    skillCursor: 0,
  };

  // ── Projects ──────────────────────────────────────────────────────────
  const insertProject = db.prepare(
    `INSERT INTO project (id, worktree, vcs, name, time_created, time_updated, time_initialized, sandboxes, commands)
     VALUES (?, ?, NULL, ?, ?, ?, NULL, '[]', NULL)`,
  );
  PROJECT_SEEDS.forEach((p, i) => {
    insertProject.run(p.id, p.worktree, p.name, EPOCH_START_MS + i * DAY_MS, EPOCH_START_MS + (390 + i) * DAY_MS);
  });

  // ── Session role assignment (120 sessions, indices reserved by category) ──
  const NUM_SESSIONS = 120;
  const longSessionIdx = 0;
  const singleMessageIdx = [1, 2, 3];
  const placeholderTitleIdx = [4, 5, 6, 7];
  const nullAgentIdx = Array.from({ length: 10 }, (_, i) => 8 + i);
  const nullModelIdx = Array.from({ length: 10 }, (_, i) => 18 + i);
  const archivedIdx = [28, 29, 30, 31, 32];
  const subagentIdx = Array.from({ length: 8 }, (_, i) => 33 + i);

  const insertSession = db.prepare(
    `INSERT INTO session (
      id, project_id, workspace_id, parent_id, slug, directory, path, title, version, share_url,
      summary_additions, summary_deletions, summary_files, summary_diffs, metadata, cost,
      tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
      revert, permission, agent, model, time_created, time_updated, time_compacting, time_archived
    ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, '1.17.7', NULL,
      0, 0, 0, NULL, NULL, 0,
      ?, ?, ?, ?, ?,
      NULL, '[]', ?, ?, ?, ?, NULL, ?)`,
  );

  const insertMessage = db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertPart = db.prepare(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertTodo = db.prepare(
    `INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertSessionMessage = db.prepare(`INSERT INTO session_message (type, seq, data) VALUES (?, ?, ?)`);

  const sessionIds: string[] = [];
  let malformedJsonInjected = false;
  let unknownTypeInjected = false;
  let missingCompletedInjected = false;
  let compactionInjected = false;
  let patchInjected = false;

  for (let i = 0; i < NUM_SESSIONS; i++) {
    const project = randChoice(rng, PROJECT_SEEDS);
    const id = `ses_${i.toString().padStart(4, "0")}`;
    sessionIds.push(id);

    const dayOffset = Math.floor((i / NUM_SESSIONS) * SPAN_DAYS);
    const timeCreated = EPOCH_START_MS + dayOffset * DAY_MS + randInt(rng, 0, DAY_MS - 1);

    const isNullAgent = nullAgentIdx.includes(i);
    const isNullModel = nullModelIdx.includes(i);
    const isArchived = archivedIdx.includes(i);
    const isSubagent = subagentIdx.includes(i);
    const isPlaceholder = placeholderTitleIdx.includes(i);
    const isSingleMessage = singleMessageIdx.includes(i);
    const isLong = i === longSessionIdx;

    const agent = isNullAgent ? null : randChoice(rng, AGENTS);
    const model = isNullModel ? null : randChoice(rng, PROVIDER_MODELS);
    const parentId = isSubagent ? (sessionIds[randInt(rng, 0, 7)] ?? null) : null;

    const sessionSlug = slug(rng);
    const directory = project.id === GLOBAL_PROJECT_ID ? `/tmp/oc-lens-fixture/${sessionSlug}` : project.worktree;
    const relPath = directory.startsWith("/") ? directory.slice(1) : directory;

    const createdIso = new Date(timeCreated).toISOString();
    const title = isPlaceholder ? `New session - ${createdIso}` : `Fixture task ${i}: ${sessionSlug}`;

    let messageCount: number;
    if (isLong) messageCount = LONG_SESSION_MESSAGE_COUNT;
    else if (isSingleMessage) messageCount = 1;
    else messageCount = randInt(rng, 20, 45);

    let sessionUsage = zeroUsage();
    let sessionTimeUpdated = timeCreated;

    // Generate messages/parts for this session first, so the session row can
    // carry accurate aggregate token totals rather than independently random ones.
    const pendingMessageRows: Array<{ id: string; time: number; data: unknown }> = [];
    const pendingPartRows: Array<{ id: string; messageId: string; time: number; data: unknown }> = [];

    let turnTime = timeCreated;
    for (let m = 0; m < messageCount; m++) {
      const isUser = m % 2 === 0 || isSingleMessage;
      const msgId = `msg_${counters.messages.toString().padStart(6, "0")}`;
      counters.messages++;
      turnTime += randInt(rng, 1000, 60_000);

      if (isUser) {
        const userText = `Fixture user prompt ${counters.messages}`;
        const data = {
          role: "user",
          time: { created: turnTime },
          agent: agent ?? "build",
          model: model ? { providerID: model.providerID, modelID: model.modelID } : null,
          summary: { diffs: [] },
        };
        pendingMessageRows.push({ id: msgId, time: turnTime, data });

        const partId = `prt_${counters.parts.toString(36).padStart(7, "0")}`;
        counters.parts++;
        pendingPartRows.push({ id: partId, messageId: msgId, time: turnTime, data: { type: "text", text: userText } });
      } else {
        const usage = randUsage(rng);
        sessionUsage = addUsage(sessionUsage, usage);
        const completedAt = turnTime + randInt(rng, 200, 8000);
        const skipCompleted = !missingCompletedInjected && randBool(rng, 0.02);
        if (skipCompleted) missingCompletedInjected = true;

        const data: Record<string, unknown> = {
          parentID: pendingMessageRows[pendingMessageRows.length - 1]?.id ?? null,
          role: "assistant",
          mode: agent ?? "build",
          agent: agent ?? "build",
          path: { cwd: directory, root: project.worktree },
          cost: 0,
          tokens: {
            total: usage.input + usage.output + usage.reasoning,
            input: usage.input,
            output: usage.output,
            reasoning: usage.reasoning,
            cache: { write: usage.cacheWrite, read: usage.cacheRead },
          },
          modelID: model?.modelID ?? "unknown",
          providerID: model?.providerID ?? "unknown",
          time: skipCompleted ? { created: turnTime } : { created: turnTime, completed: completedAt },
          finish: "stop",
        };
        pendingMessageRows.push({ id: msgId, time: completedAt, data });

        // step-start
        pendingPartRows.push({
          id: `prt_${counters.parts.toString(36).padStart(7, "0")}`,
          messageId: msgId,
          time: turnTime,
          data: { type: "step-start" },
        });
        counters.parts++;

        const contentPartCount = randInt(rng, 2, 5);
        for (let c = 0; c < contentPartCount; c++) {
          const partId = `prt_${counters.parts.toString(36).padStart(7, "0")}`;
          counters.parts++;
          if (!compactionInjected && randBool(rng, 0.01)) {
            compactionInjected = true;
            // Real shape confirmed live against a developer's opencode.db on 2026-08-02 (data-model §5).
            pendingPartRows.push({
              id: partId,
              messageId: msgId,
              time: turnTime,
              data: { type: "compaction", auto: true, overflow: false, tail_start_id: pendingMessageRows[0]?.id ?? msgId },
            });
            continue;
          }
          if (!patchInjected && randBool(rng, 0.01)) {
            patchInjected = true;
            // Real shape confirmed live against a developer's opencode.db on 2026-08-02 (data-model §5).
            // Deliberately not tied to this message's own tool calls — real patch parts
            // aren't either; they're a workspace-wide diff snapshot (see data-model §5).
            pendingPartRows.push({
              id: partId,
              messageId: msgId,
              time: turnTime,
              data: { type: "patch", hash: "094c0ec1231b737617bded055272857a3c644f8a", files: ["/repo/fixture-diff-file.ts"] },
            });
            continue;
          }
          const kind = randChoice(rng, ["text", "reasoning", "tool"] as const);
          if (kind === "text") {
            pendingPartRows.push({
              id: partId,
              messageId: msgId,
              time: turnTime,
              data: { type: "text", text: `Fixture assistant text ${partId}` },
            });
          } else if (kind === "reasoning") {
            const rStart = turnTime;
            const rEnd = rStart + randInt(rng, 50, 500);
            pendingPartRows.push({
              id: partId,
              messageId: msgId,
              time: turnTime,
              data: { type: "reasoning", text: "Fixture reasoning trace", time: { start: rStart, end: rEnd } },
            });
          } else {
            const call = nextToolCall(rng, counters, turnTime);
            let partData: unknown;
            if (!unknownTypeInjected && randBool(rng, 0.01)) {
              unknownTypeInjected = true;
              partData = { type: "fixture-unknown-part-type", note: "deliberate dirt for decoder testing" };
            } else {
              partData = {
                type: "tool",
                tool: call.tool,
                callID: call.callId,
                state: {
                  status: call.status,
                  input: call.input,
                  output: call.output,
                  metadata: {},
                  title: call.title,
                  ...(call.timeStart !== null
                    ? { time: call.timeEnd !== null ? { start: call.timeStart, end: call.timeEnd } : { start: call.timeStart } }
                    : {}),
                },
              };
            }
            pendingPartRows.push({ id: partId, messageId: msgId, time: turnTime, data: partData });
          }
        }

        // step-finish
        pendingPartRows.push({
          id: `prt_${counters.parts.toString(36).padStart(7, "0")}`,
          messageId: msgId,
          time: completedAt,
          data: {
            type: "step-finish",
            reason: "stop",
            cost: 0,
            tokens: {
              total: usage.input + usage.output + usage.reasoning,
              input: usage.input,
              output: usage.output,
              reasoning: usage.reasoning,
              cache: { write: usage.cacheWrite, read: usage.cacheRead },
            },
          },
        });
        counters.parts++;

        turnTime = completedAt;
        sessionTimeUpdated = completedAt;
      }
    }

    for (const row of pendingMessageRows) {
      let dataStr = JSON.stringify(row.data);
      if (!malformedJsonInjected && randBool(rng, 0.01)) {
        malformedJsonInjected = true;
        dataStr = "{not valid json";
      }
      insertMessage.run(row.id, id, row.time, row.time, dataStr);
    }
    for (const row of pendingPartRows) {
      insertPart.run(row.id, row.messageId, id, row.time, row.time, JSON.stringify(row.data));
    }

    insertSession.run(
      id,
      project.id,
      parentId,
      sessionSlug,
      directory,
      relPath,
      title,
      sessionUsage.input,
      sessionUsage.output,
      sessionUsage.reasoning,
      sessionUsage.cacheRead,
      sessionUsage.cacheWrite,
      agent,
      model ? JSON.stringify({ id: model.modelID, providerID: model.providerID, variant: "default" }) : null,
      timeCreated,
      sessionTimeUpdated,
      isArchived ? sessionTimeUpdated + DAY_MS : null,
    );

    // session_message: agent-switched + model-switched lifecycle events.
    insertSessionMessage.run(
      "agent-switched",
      counters.sessionMessages++,
      JSON.stringify({ sessionId: id, to: agent ?? "build", time: timeCreated }),
    );
    insertSessionMessage.run(
      "model-switched",
      counters.sessionMessages++,
      JSON.stringify({ sessionId: id, to: model?.modelID ?? "unknown", time: timeCreated }),
    );

    // A handful of todos on some sessions, cycling through all three statuses.
    if (i % 15 === 0) {
      const statuses = ["pending", "in_progress", "completed"] as const;
      for (let t = 0; t < 3; t++) {
        insertTodo.run(
          id,
          `Fixture todo ${counters.todos}`,
          statuses[t] as (typeof statuses)[number],
          "normal",
          t,
          timeCreated,
          timeCreated,
        );
        counters.todos++;
      }
    }
  }

  // Top up error-tool-call count if random distribution fell short of the minimum.
  if (counters.errorToolCalls < 40) {
    const extraNeeded = 40 - counters.errorToolCalls;
    const lastSessionId = sessionIds[sessionIds.length - 1] as string;
    const msgId = `msg_${counters.messages.toString().padStart(6, "0")}`;
    counters.messages++;
    insertMessage.run(
      msgId,
      lastSessionId,
      EPOCH_START_MS,
      EPOCH_START_MS,
      JSON.stringify({
        role: "assistant",
        mode: "build",
        agent: "build",
        path: { cwd: "/tmp", root: "/" },
        cost: 0,
        tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { write: 0, read: 0 } },
        modelID: "unknown",
        providerID: "unknown",
        time: { created: EPOCH_START_MS, completed: EPOCH_START_MS },
        finish: "stop",
      }),
    );
    for (let e = 0; e < extraNeeded; e++) {
      const partId = `prt_${counters.parts.toString(36).padStart(7, "0")}`;
      counters.parts++;
      counters.errorToolCalls++;
      insertPart.run(
        partId,
        msgId,
        lastSessionId,
        EPOCH_START_MS,
        EPOCH_START_MS,
        JSON.stringify({
          type: "tool",
          tool: randChoice(rng, CORE_TOOLS),
          callID: `call_topup_${e}`,
          state: {
            status: "error",
            input: {},
            output: randChoice(rng, ERROR_MESSAGES),
            metadata: {},
            title: "topup error call",
            time: { start: EPOCH_START_MS, end: EPOCH_START_MS + 10 },
          },
        }),
      );
    }
  }

  db.exec("COMMIT;");
  db.close();

  process.stdout.write(
    `Fixture built: ${NUM_SESSIONS} sessions, ${counters.messages} messages, ${counters.parts} parts, ` +
      `${counters.todos} todos, ${counters.errorToolCalls} error tool calls.\n`,
  );
}

// Only run when executed directly (`pnpm fixture`), not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith("build-fixture.ts")) {
  main();
}

export { main as buildFixtures };

import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import { createPrng, randChoice, randInt, type Rng } from "./prng";
import { V2_SCHEMA_SQL } from "./v2-fixture";

/**
 * A synthetic opencode 2.x history for screenshots and local demos — never
 * used by tests, and never derived from a real database.
 *
 * Content is seeded, so two builds on the same day are identical. Times are
 * anchored to the day it is built, so the dashboard's default "last 30 days"
 * views have data. Two "bad provider days" carry the failure modes the
 * provider audit exists to show: rate limits, a broken stream with hidden
 * retries, steps that retried and then succeeded, and slow starts. Two
 * sessions contain real loops.
 *
 * Row shapes follow the verified 2.x shapes in project-docs/opencode-data-model.md §8.
 */

const DAY = 86_400_000;
const SEED = 20_261_028;
const OUT = join(process.cwd(), "test", "fixtures", "demo.db");

const PROJECTS = [
  { id: "prj_storefront", worktree: "/home/dev/storefront", name: "storefront" },
  { id: "prj_billing", worktree: "/home/dev/billing-api", name: "billing-api" },
  { id: "prj_infra", worktree: "/home/dev/infra", name: "infra" },
] as const;

const MODELS = [
  { id: "claude-sonnet-5", providerID: "anthropic", variant: "default", usual: 5 },
  { id: "gpt-5-mini", providerID: "openai", variant: "default", usual: 3 },
  { id: "qwen3-coder", providerID: "opencode", variant: "default", usual: 7 },
] as const;

const TITLES = [
  "Fix flaky checkout test", "Add rate limiting to webhooks", "Migrate invoices to the new schema", "Speed up the product search query",
  "Refactor the cart reducer", "Add retries to the payment client", "Upgrade to Node 24", "Write tests for refund flows",
  "Investigate the memory leak in workers", "Add a dark mode toggle", "Clean up feature flags", "Document the deploy pipeline",
  "Fix timezone bug in reports", "Split the monolith config", "Add OpenTelemetry tracing", "Harden the file upload endpoint",
  "Review the Terraform plan", "Cache exchange rates", "Paginate the admin user list", "Fix N+1 queries in orders",
];

const FILES = ["src/cart.ts", "src/checkout.ts", "src/api/client.ts", "src/db/schema.ts", "src/workers/queue.ts", "src/components/Header.tsx", "test/checkout.test.ts", "infra/main.tf"];

interface Row { id: string; type: string; time: number; data: Record<string, unknown> }
type Model = (typeof MODELS)[number];

let counter = 0;
const nextId = (prefix: string) => `${prefix}_demo${String(++counter).padStart(6, "0")}`;

function tool(rng: Rng, time: number, name: string, input: Record<string, unknown>, output: string, metadata: Record<string, unknown> = {}): Record<string, unknown> {
  const ran = time + randInt(rng, 100, 600);
  return {
    type: "tool", id: nextId("call"), name, executed: false,
    state: { status: "completed", input, content: [{ type: "text", text: output }], metadata: { truncated: false, ...metadata } },
    time: { created: time, ran, completed: ran + randInt(rng, 200, 4_000) },
  };
}

// Ordinary work never repeats an identical call, so every generated input is unique;
// only the scripted scenarios below produce repeats the loop detector should report.
function randomTool(rng: Rng, time: number): Record<string, unknown> {
  const n = ++counter;
  const file = `${randChoice(rng, FILES).replace(/\.(tsx?|tf)$/, "")}-${n}.ts`;
  switch (randInt(rng, 0, 4)) {
    case 0: return tool(rng, time, "read", { filePath: file }, "…");
    case 1: return tool(rng, time, "edit", { filePath: file, oldString: `old-${n}`, newString: `new-${n}` }, "Edit applied");
    case 2: return tool(rng, time, "grep", { pattern: `${randChoice(rng, ["TODO", "retry", "cache", "invoice"])}-${n}`, path: "src" }, "4 matches");
    case 3: return tool(rng, time, "glob", { pattern: `src/feature-${n}/**/*.ts` }, "12 files");
    default: return tool(rng, time, "shell", { command: `pnpm vitest run test/unit-${n}.test.ts` }, "ok", { exit: 0, status: "completed" });
  }
}

interface SessionState {
  id: string;
  model: Model;
  agent: string;
  context: number; // tokens already in the conversation (cached on the next step)
  rows: Row[];
  totals: { input: number; output: number; reasoning: number; read: number };
  time: number;
}

function wait(rng: Rng, model: Model, badDay: boolean): number {
  // A normal step starts within a few seconds; on a bad day a third of steps sit in a queue or retry.
  if (badDay && rng() < 0.35) return randInt(rng, 35, 125);
  return Math.max(1, model.usual + randInt(rng, -2, 4));
}

function step(rng: Rng, s: SessionState, content: unknown[], opts: { finish?: string; badDay: boolean; cacheRead?: number; retry?: Record<string, unknown> }): void {
  const fresh = randInt(rng, 300, 2_500);
  const read = opts.cacheRead ?? s.context;
  const output = randInt(rng, 40, 420);
  const reasoning = randInt(rng, 0, 120);
  const created = s.time;
  const streamed = created + wait(rng, s.model, opts.badDay) * 1000;
  const completed = streamed + randInt(rng, 1_500, 9_000);
  s.rows.push({
    id: nextId("msg"), type: "assistant", time: created,
    data: {
      agent: s.agent, model: { id: s.model.id, providerID: s.model.providerID, variant: s.model.variant }, content, cost: 0,
      tokens: { input: fresh + (s.context - read), output, reasoning, cache: { read, write: 0 } },
      finish: opts.finish ?? "tool-calls", time: { created, streamed, completed },
      ...(opts.retry ? { retry: opts.retry } : {}),
    },
  });
  s.totals.input += fresh + (s.context - read); s.totals.output += output; s.totals.reasoning += reasoning; s.totals.read += read;
  s.context += fresh + output;
  s.time = completed + randInt(rng, 500, 3_000);
}

function failedStep(s: SessionState, error: Record<string, unknown>, retry?: Record<string, unknown>): void {
  s.rows.push({
    id: nextId("msg"), type: "assistant", time: s.time,
    data: { agent: s.agent, model: { id: s.model.id, providerID: s.model.providerID, variant: s.model.variant }, content: [], finish: "error", time: { created: s.time }, error, ...(retry ? { retry } : {}) },
  });
  s.time += 60_000;
}

function user(s: SessionState, text: string): void {
  s.rows.push({ id: nextId("msg"), type: "user", time: s.time, data: { text, time: { created: s.time } } });
  s.time += 2_000;
}

function event(s: SessionState, type: string, data: Record<string, unknown>): void {
  s.rows.push({ id: nextId("msg"), type, time: s.time, data: { ...data, time: { created: s.time } } });
  s.time += 1_000;
}

function buildSession(rng: Rng, id: string, start: number, badDay: boolean, scenario: "normal" | "rate-limit" | "broken-stream" | "test-loop" | "reread-loop"): SessionState {
  const s: SessionState = { id, model: randChoice(rng, MODELS), agent: randChoice(rng, ["build", "build", "plan"]), context: randInt(rng, 6_000, 14_000), rows: [], totals: { input: 0, output: 0, reasoning: 0, read: 0 }, time: start };
  const turns = randInt(rng, 2, 5);
  for (let turn = 0; turn < turns; turn += 1) {
    user(s, turn === 0 ? "Let's start." : randChoice(rng, ["Looks good, continue.", "Now run the tests.", "Can you also handle the edge case?", "Why did that fail?"]));
    const steps = randInt(rng, 2, 7);
    for (let n = 0; n < steps; n += 1) {
      const calls = Array.from({ length: randInt(rng, 1, 2) }, () => randomTool(rng, s.time));
      // On a bad day some steps retried a 500 inside the step and then succeeded.
      const retry = badDay && rng() < 0.12 ? { attempt: randInt(rng, 1, 3), at: s.time + 8_000, error: { type: "provider.internal", message: "Internal server error", status: 500 } } : undefined;
      step(rng, s, calls, { badDay, retry });
    }
    if (turn === 1 && scenario === "rate-limit") {
      const error = { type: "provider.rate-limit", message: "Rate limit reached: tokens per minute", status: 429 };
      failedStep(s, error, { attempt: 3, at: s.time + 45_000, error });
      event(s, "idle", { outcome: "failed", error });
      s.time += 4 * 60_000;
      user(s, "Try again.");
      // The cache expired while waiting: the replay pays the whole context at the input price.
      step(rng, s, [randomTool(rng, s.time)], { badDay, cacheRead: 0 });
    }
    if (turn === 1 && scenario === "broken-stream") {
      const error = { type: "provider.transport", message: "Connection lost while reading the response", status: 200 };
      failedStep(s, error, { attempt: 4, at: s.time + 50_000, error });
      event(s, "synthetic", { text: "The previous response was interrupted. Continue from where you left off." });
      step(rng, s, [randomTool(rng, s.time)], { badDay });
    }
    if (turn === 1 && scenario === "test-loop") {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        step(rng, s, [tool(rng, s.time, "shell", { command: "pnpm test checkout" }, "FAIL test/checkout.test.ts", { exit: 1, status: "completed" })], { badDay });
      }
    }
    if (turn === 1 && scenario === "reread-loop") {
      for (let attempt = 0; attempt < 3; attempt += 1) step(rng, s, [tool(rng, s.time, "read", { filePath: "src/db/schema.ts" }, "…")], { badDay });
    }
    step(rng, s, [{ type: "text", text: "Done — summary of the change above." }], { finish: "stop", badDay });
    event(s, "idle", { outcome: "succeeded" });
    if (turn === 0 && s.agent === "plan") {
      event(s, "agent-switched", { agent: "build", previous: "plan" });
      s.agent = "build";
    }
    s.time += randInt(rng, 2, 25) * 60_000;
  }
  return s;
}

export function buildDemo(path = OUT, anchor = Date.now()): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(`${path}${suffix}`, { force: true });
  const rng = createPrng(SEED);
  const end = new Date(anchor);
  end.setHours(18, 0, 0, 0);
  const db = new DatabaseSync(path);
  db.exec(V2_SCHEMA_SQL);
  db.exec("BEGIN");
  const t0 = end.getTime() - 30 * DAY;
  for (const project of PROJECTS) {
    db.prepare("INSERT INTO project (id, worktree, vcs, name, time_created, time_updated, sandboxes) VALUES (?, ?, 'git', ?, ?, ?, '[]')").run(project.id, project.worktree, project.name, t0, end.getTime());
  }
  const insertSession = db.prepare(`INSERT INTO session_v2 (id, project_id, parent_id, slug, directory, path, title, version, cost, tokens_input, tokens_output,
    tokens_reasoning, tokens_cache_read, tokens_cache_write, agent, model, time_created, time_updated, time_idle, idle_outcome)
    VALUES (?, ?, NULL, ?, ?, '', ?, '2.2.0', 0, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`);
  const insertMessage = db.prepare("INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const badDays = new Set([6, 2]); // days before the anchor
  const scenarios: Record<number, "rate-limit" | "broken-stream" | "test-loop" | "reread-loop"> = { 6: "rate-limit", 2: "broken-stream", 12: "test-loop", 19: "reread-loop" };
  let titleIndex = 0;
  for (let daysAgo = 29; daysAgo >= 0; daysAgo -= 1) {
    const day = end.getTime() - daysAgo * DAY;
    const weekend = [0, 6].includes(new Date(day).getDay());
    const count = weekend ? randInt(rng, 0, 1) : randInt(rng, 1, 2);
    for (let n = 0; n < count; n += 1) {
      const start = day - randInt(rng, 2, 9) * 3_600_000;
      const scenario = n === 0 ? scenarios[daysAgo] ?? "normal" : "normal";
      const s = buildSession(rng, nextId("ses"), start, badDays.has(daysAgo), scenario);
      const project = randChoice(rng, PROJECTS);
      const title = TITLES[titleIndex++ % TITLES.length] ?? "Demo session";
      insertSession.run(s.id, project.id, `${title.toLowerCase().replace(/[^a-z]+/g, "-").slice(0, 20)}-${n}`, project.worktree, title,
        s.totals.input, s.totals.output, s.totals.reasoning, s.totals.read, s.agent, JSON.stringify({ id: s.model.id, providerID: s.model.providerID, variant: s.model.variant }),
        // Every demo session ends on a successful turn, so its last idle outcome is "succeeded".
        start, s.time, s.time, "succeeded");
      s.rows.forEach((row, seq) => insertMessage.run(row.id, s.id, row.type, seq, row.time, row.time, JSON.stringify(row.data)));
    }
  }
  db.exec("COMMIT");
  db.close();
}

if (process.argv[1]?.endsWith("build-demo.ts")) {
  buildDemo();
  console.log(`Wrote ${OUT}`);
}

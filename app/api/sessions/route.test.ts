import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { resetConnectionForTests, type ConnectResult } from "@/lib/db/connection";
import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";
import { POPULATED_DB_PATH } from "@/test/fixtures";
import { GET as getSession } from "./[id]/route";
import { GET as listSessions } from "./route";

const connectionOverride = vi.hoisted((): { value: ConnectResult | undefined } => ({ value: undefined }));

vi.mock("@/lib/db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/connection")>();
  return {
    ...actual,
    getConnection: (...args: Parameters<typeof actual.getConnection>): ConnectResult =>
      connectionOverride.value ?? actual.getConnection(...args),
  };
});

interface ListBody {
  data?: {
    sessions: Array<{
      id: string;
      slug: string;
      projectId: string;
      agent: string | null;
      parentId: string | null;
      timeArchived: number | null;
      model: { id: string; providerID: string } | null;
      durationMs: number | null;
      messageCounts: { user: number; assistant: number };
      toolCallCount: number;
      tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number };
      cost: { amount: number; priced: boolean };
      [key: string]: unknown;
    }>;
    totalCount: number;
    nextCursor: string | null;
  };
  error?: { code: string; message: string };
  meta?: { warnings: unknown[] };
}

const originalDb = process.env.OC_LENS_DB;
const originalConfigHome = process.env.XDG_CONFIG_HOME;
const dir = makeTempDir();
const populatedCopy = join(dir, "populated.db");
const configHome = join(dir, "config");
copyFileSync(POPULATED_DB_PATH, populatedCopy);

function useDb(path: string): void {
  connectionOverride.value = undefined;
  resetConnectionForTests();
  process.env.OC_LENS_DB = path;
}

async function list(query = ""): Promise<{ response: Response; body: ListBody }> {
  const response = await listSessions(new Request(`http://localhost/api/sessions${query}`));
  return { response, body: await response.json() as ListBody };
}

beforeAll(() => {
  mkdirSync(join(configHome, "opencode"), { recursive: true });
  writeFileSync(
    join(configHome, "opencode", "opencode.jsonc"),
    JSON.stringify({ mcp: { linear_docs: { type: "remote" }, serena: { type: "local" } } }),
  );
  process.env.XDG_CONFIG_HOME = configHome;
  useDb(populatedCopy);
});

afterAll(() => {
  resetConnectionForTests();
  if (originalDb === undefined) delete process.env.OC_LENS_DB;
  else process.env.OC_LENS_DB = originalDb;
  if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalConfigHome;
  cleanupTempDir(dir);
});

describe("GET /api/sessions", () => {
  it("returns the typed envelope, total count, and a slug search from the populated fixture", async () => {
    const { response, body } = await list("?search=lucid-vole&limit=100");

    expect(response.status).toBe(200);
    expect(body.data?.totalCount).toBe(3);
    expect(body.data?.sessions.map((session) => session.id)).toEqual(["ses_0027", "ses_0016", "ses_0000"]);
    expect(body.data?.sessions.every((session) => session.slug === "lucid-vole")).toBe(true);
    expect(body.data?.nextCursor).toBeNull();
    expect(body.meta?.warnings).toBeInstanceOf(Array);
  });

  it("sets usesMcp from configured server names instead of silently returning false", async () => {
    const db = new DatabaseSync(populatedCopy, { readOnly: true });
    const row = db.prepare("SELECT session_id FROM part WHERE data LIKE '%linear_docs_search%' LIMIT 1").get() as { session_id: string };
    db.close();

    const { body } = await list(`?search=${encodeURIComponent(row.session_id)}&limit=100`);

    expect(body.data?.sessions.find((session) => session.id === row.session_id)?.usesMcp).toBe(true);
  });

  it.each([
    ["?project=proj_infra&limit=100", 25],
    ["?agent=unknown&limit=100", 10],
    ["?model=unknown&limit=100", 10],
    ["?model=opencode/qwen3-coder&limit=100", 21],
    ["?archived=true&limit=100", 5],
    ["?archived=false&limit=100", 115],
    ["?isSubagent=true&limit=100", 8],
    ["?is-subagent=false&limit=100", 112],
    ["?hasError=true&limit=100", 107],
    ["?has-error=false&limit=100", 13],
  ])("applies fixture filter %s with its hand-counted total", async (query, expected) => {
    const { body } = await list(query);
    expect(body.data?.totalCount).toBe(expected);
  });

  it("composes project, agent, and half-open date-range filters", async () => {
    const { body } = await list("?project=proj_infra&agent=build&from=1756000000000&to=1760000000000&limit=100");
    expect(body.data?.sessions.map((session) => session.id)).toEqual(["ses_0025", "ses_0022", "ses_0020"]);
    expect(body.data?.totalCount).toBe(3);
  });

  it.each([
    ["timeCreated", "ses_0119"],
    ["timeUpdated", "ses_0119"],
    ["timeArchived", "ses_0032"],
    ["durationMs", "ses_0000"],
    ["messages", "ses_0000"],
    ["userMessages", "ses_0000"],
    ["assistantMessages", "ses_0000"],
    ["toolCallCount", "ses_0000"],
    ["tokens", "ses_0000"],
    ["inputTokens", "ses_0000"],
    ["outputTokens", "ses_0000"],
    ["reasoningTokens", "ses_0000"],
    ["cacheReadTokens", "ses_0000"],
    ["cacheWriteTokens", "ses_0000"],
    ["cost", "ses_0000"],
  ])("sorts numeric column %s descending with a deterministic id tie-break", async (sort, expectedFirstId) => {
    const { body } = await list(`?sort=${sort}&order=desc&limit=1`);
    expect(body.data?.sessions[0]?.id).toBe(expectedFirstId);
  });

  it("paginates stably through a tied numeric sort without overlap", async () => {
    const first = await list("?sort=cost&order=desc&limit=7");
    expect(first.body.data?.sessions.map((session) => session.id)).toEqual([
      "ses_0000", "ses_0001", "ses_0002", "ses_0003", "ses_0004", "ses_0005", "ses_0006",
    ]);
    const cursor = first.body.data?.nextCursor;
    expect(cursor).toBeTruthy();

    const second = await list(`?sort=cost&order=desc&limit=7&cursor=${encodeURIComponent(cursor ?? "")}`);
    expect(second.body.data?.sessions.map((session) => session.id)).toEqual([
      "ses_0007", "ses_0008", "ses_0009", "ses_0010", "ses_0011", "ses_0012", "ses_0013",
    ]);
    expect(new Set([
      ...(first.body.data?.sessions.map((session) => session.id) ?? []),
      ...(second.body.data?.sessions.map((session) => session.id) ?? []),
    ]).size).toBe(14);
    expect(second.body.data?.totalCount).toBe(120);
  });

  it.each([
    "?archived=yes",
    "?from=10&to=9",
    "?limit=0",
    "?limit=101",
    "?sort=title",
    "?order=sideways",
    "?cursor=not-a-cursor",
    "?unexpected=true",
    "?hasError=true&has-error=true",
  ])("rejects invalid input: %s", async (query) => {
    const { response, body } = await list(query);
    expect(response.status).toBe(400);
    expect(body.error?.code).toMatch(/^invalid_(query|cursor)$/);
  });

  it("returns an honest empty response for a valid zero-row database", async () => {
    const emptyPath = join(dir, "empty.db");
    createFullSchemaDb(emptyPath);
    const writable = new DatabaseSync(emptyPath);
    writable.exec("DELETE FROM part; DELETE FROM message; DELETE FROM session; DELETE FROM project;");
    writable.close();
    useDb(emptyPath);

    const { response, body } = await list();
    expect(response.status).toBe(200);
    expect(body.data).toEqual({ sessions: [], totalCount: 0, nextCursor: null });
    useDb(populatedCopy);
  });

  it("completes against the 120-session fixture in under 200 ms", async () => {
    useDb(populatedCopy);
    const started = performance.now();
    const { response } = await list("?limit=25");
    expect(response.status).toBe(200);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("GET /api/sessions/[id]", () => {
  async function detail(id: string): Promise<{ response: Response; body: ListBody & { data?: ListBody["data"] & { childIds?: string[] } } }> {
    const response = await getSession(
      new Request(`http://localhost/api/sessions/${encodeURIComponent(id)}`),
      { params: Promise.resolve({ id }) },
    );
    return { response, body: await response.json() };
  }

  it("returns fixture session detail and ordered child ids", async () => {
    useDb(populatedCopy);
    const { response, body } = await detail("ses_0000");
    expect(response.status).toBe(200);
    expect((body.data as unknown as { id: string }).id).toBe("ses_0000");
    expect((body.data as unknown as { childIds: string[] }).childIds).toEqual(["ses_0035", "ses_0036", "ses_0038"]);
  });

  it("distinguishes a missing session from a missing database", async () => {
    useDb(populatedCopy);
    const missingSession = await detail("ses_missing");
    expect(missingSession.response.status).toBe(404);
    expect(missingSession.body.error?.code).toBe("session_not_found");

    resetConnectionForTests();
    connectionOverride.value = { ok: false, reason: "not-found", searched: [join(dir, "does-not-exist.db")] };
    const missingDatabase = await detail("ses_0000");
    expect(missingDatabase.response.status).toBe(404);
    expect(missingDatabase.body.error?.code).toBe("database_not_found");
    connectionOverride.value = undefined;
  });

  it("returns 409 for an unsupported schema", async () => {
    const mismatchPath = join(dir, "mismatch.db");
    const mismatch = new DatabaseSync(mismatchPath);
    mismatch.exec("CREATE TABLE project (id TEXT PRIMARY KEY)");
    mismatch.close();
    useDb(mismatchPath);

    const { response, body } = await detail("ses_0000");
    expect(response.status).toBe(409);
    expect(body.error?.code).toBe("schema_mismatch");
  });
});

import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { resetConnectionForTests, type ConnectResult } from "@/lib/db/connection";
import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";
import { addDenylistedSecretRows, FORBIDDEN_SERIALIZED_FIELD } from "@/test/security/export-secret-fixture";
import { POPULATED_DB_PATH } from "@/test/fixtures";
import type { ExportResponse, ExportRouteResponse } from "@/types/oc";
import { GET } from "./route";

const connectionOverride = vi.hoisted((): { value: ConnectResult | undefined } => ({ value: undefined }));

vi.mock("@/lib/db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/connection")>();
  return {
    ...actual,
    getConnection: (...args: Parameters<typeof actual.getConnection>): ConnectResult =>
      connectionOverride.value ?? actual.getConnection(...args),
  };
});

const originalDb = process.env.OC_LENS_DB;
const originalConfigHome = process.env.XDG_CONFIG_HOME;
const dir = makeTempDir();
const configHome = join(dir, "config");
const populatedCopy = join(dir, "populated.db");
const SECRET_ACCOUNT = "export-must-not-leak-sentinel-one-7e18";
const SECRET_CREDENTIAL = "export-must-not-leak-sentinel-two-9b42";

function useDb(path: string): void {
  connectionOverride.value = undefined;
  resetConnectionForTests();
  process.env.OC_LENS_DB = path;
}

async function parsed(query: string): Promise<{ response: Response; body: ExportRouteResponse }> {
  const response = await GET(new Request(`http://localhost/api/export${query}`));
  return { response, body: JSON.parse(await response.text()) as ExportRouteResponse };
}

function data(body: ExportRouteResponse): ExportResponse {
  if (!("data" in body)) throw new Error("Expected successful export response");
  return body.data;
}

beforeAll(() => {
  process.env.XDG_CONFIG_HOME = configHome;
  copyFileSync(POPULATED_DB_PATH, populatedCopy);
  const db = new DatabaseSync(populatedCopy);
  addDenylistedSecretRows(db, SECRET_ACCOUNT, SECRET_CREDENTIAL);
  db.close();
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

describe("OCL-120 GET /api/export", () => {
  it("makes preview counts exactly match streamed sessions, replay turns/parts, and todos", async () => {
    useDb(populatedCopy);
    const preview = data((await parsed("?preview=1&scope=sessions,replay,todos")).body);

    const response = await GET(new Request("http://localhost/api/export?scope=sessions,replay,todos"));
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    const body = JSON.parse(await response.text()) as ExportRouteResponse;
    const exported = data(body);

    expect(exported.counts).toEqual(preview.counts);
    expect(exported.sessions).toHaveLength(exported.counts.sessions);
    expect(exported.replays).toHaveLength(exported.counts.sessions);
    expect(exported.replays?.reduce((sum, replay) => sum + replay.turns.length, 0)).toBe(exported.counts.messages);
    expect(exported.replays?.reduce((sum, replay) => sum + replay.turns.reduce((turnSum, turn) => turnSum + turn.parts.length, 0), 0)).toBe(exported.counts.parts);
    expect(exported.todos?.sessions.reduce((sum, session) => sum + session.todos.length, 0)).toBe(exported.counts.todos);
  }, 30_000);

  it("streams the 12k-part replay incrementally and never exports denylisted-table secrets", async () => {
    const largePath = join(dir, "single-session-12k.db");
    createFullSchemaDb(largePath);
    const largeDb = new DatabaseSync(largePath);
    largeDb.exec("DELETE FROM part; DELETE FROM message;");
    addDenylistedSecretRows(largeDb, SECRET_ACCOUNT, SECRET_CREDENTIAL);
    largeDb.exec("BEGIN;");
    const at = Date.UTC(2024, 0, 1);
    largeDb.prepare("UPDATE session SET time_created = ?, time_updated = ?, title = ?, slug = ? WHERE id = 'ses_1'")
      .run(at, at + 1, "Twelve thousand parts", "large-replay");
    largeDb.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('msg_large', 'ses_1', ?, ?, ?)")
      .run(at, at + 1, JSON.stringify({ role: "assistant", agent: "build", time: { created: at, completed: at + 1 }, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }));
    const insertPart = largeDb.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, 'msg_large', 'ses_1', ?, ?, ?)");
    for (let index = 0; index < 12_000; index += 1) {
      insertPart.run(`prt_${index.toString().padStart(5, "0")}`, at, at, JSON.stringify({ type: "text", text: `bounded part ${index}` }));
    }
    largeDb.exec("COMMIT;");
    largeDb.close();
    useDb(largePath);
    const response = await GET(new Request("http://localhost/api/export?scope=replay"));
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const chunks: Uint8Array[] = [];
    let firstChunkText = "";
    while (true) {
      const next = await reader!.read();
      if (next.done) break;
      if (chunks.length === 0) firstChunkText = new TextDecoder().decode(next.value);
      chunks.push(next.value);
    }
    // The first chunk is only the manifest prefix; replay queries happen as
    // the consumer pulls subsequent chunks, proving the route did not first
    // materialize/stringify one whole 12k-part response object.
    expect(firstChunkText).toContain('"counts"');
    expect(firstChunkText).not.toContain('"replays"');
    expect(chunks.length).toBeGreaterThan(12_000);
    expect(Math.max(...chunks.map((chunk) => chunk.byteLength))).toBeLessThanOrEqual(40 * 1024);

    const output = new TextDecoder().decode(Buffer.concat(chunks));
    const exported = data(JSON.parse(output) as ExportRouteResponse);
    expect(exported.counts).toEqual({ sessions: 1, messages: 1, parts: 12_000, todos: 0 });
    expect(exported.replays?.[0]?.turns[0]?.parts).toHaveLength(12_000);
    expect(output).not.toContain(SECRET_ACCOUNT);
    expect(output).not.toContain(SECRET_CREDENTIAL);
    expect(output).not.toContain(FORBIDDEN_SERIALIZED_FIELD);
  }, 30_000);

  it("interprets inclusive calendar dates in the requested timezone", async () => {
    const dateDbPath = join(dir, "date-range.db");
    createFullSchemaDb(dateDbPath);
    const db = new DatabaseSync(dateDbPath);
    db.exec("DELETE FROM part; DELETE FROM message;");
    // 2024-01-01 11:30 UTC is 2024-01-02 00:30 in Pacific/Auckland.
    const at = Date.UTC(2024, 0, 1, 11, 30);
    db.prepare("UPDATE session SET time_created = ?, time_updated = ? WHERE id = 'ses_1'").run(at, at);
    db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('m_date', 'ses_1', ?, ?, ?)")
      .run(at, at, JSON.stringify({ role: "user", time: { created: at } }));
    db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('p_date', 'm_date', 'ses_1', ?, ?, ?)")
      .run(at, at, JSON.stringify({ type: "text", text: "date boundary" }));
    db.prepare("INSERT INTO todo (session_id, content, status, position, time_created, time_updated) VALUES ('ses_1', 'date todo', 'pending', 0, ?, ?)")
      .run(at, at);
    db.close();

    useDb(dateDbPath);
    const auckland = data((await parsed("?preview=1&from=2024-01-02&to=2024-01-02&tz=Pacific%2FAuckland")).body);
    expect(auckland.counts).toEqual({ sessions: 1, messages: 1, parts: 1, todos: 1 });
    expect(auckland.rangeFrom).toBe(Date.UTC(2024, 0, 1, 11));
    expect(auckland.rangeTo).toBe(Date.UTC(2024, 0, 2, 11));
    useDb(dateDbPath);
    const aucklandActivity = data((await parsed("?scope=activity&from=2024-01-02&to=2024-01-02&tz=Pacific%2FAuckland")).body);
    expect(aucklandActivity.activity?.dailyActivity.map((day) => day.date)).toEqual(["2024-01-02"]);
    expect(aucklandActivity.activity?.streaks).toMatchObject({ totalActiveDays: 1, firstSessionDate: "2024-01-02" });

    useDb(dateDbPath);
    const utc = data((await parsed("?preview=1&from=2024-01-02&to=2024-01-02&tz=UTC")).body);
    expect(utc.counts).toEqual({ sessions: 0, messages: 0, parts: 0, todos: 0 });
    useDb(dateDbPath);
    const utcActivity = data((await parsed("?scope=activity&from=2024-01-02&to=2024-01-02&tz=UTC")).body);
    expect(utcActivity.activity?.dailyActivity).toEqual([]);
    expect(utcActivity.activity?.streaks.totalActiveDays).toBe(0);
  });

  it("returns only requested scopes and leaves preview count-only", async () => {
    useDb(populatedCopy);
    const preview = data((await parsed("?preview=1&scope=activity&from=2026-01-01&to=2026-12-31&tz=UTC")).body);
    expect(preview).not.toHaveProperty("activity");
    expect(preview).not.toHaveProperty("sessions");

    useDb(populatedCopy);
    const exported = data((await parsed("?scope=activity&from=2026-01-01&to=2026-12-31&tz=UTC")).body);
    expect(exported).toHaveProperty("activity");
    expect(exported).not.toHaveProperty("sessions");
    expect(exported).not.toHaveProperty("tools");
  });

  it("returns a valid empty streamed export", async () => {
    const emptyPath = join(dir, "empty.db");
    createFullSchemaDb(emptyPath);
    const db = new DatabaseSync(emptyPath);
    db.exec("DELETE FROM part; DELETE FROM message; DELETE FROM todo; DELETE FROM session; DELETE FROM project;");
    db.close();
    useDb(emptyPath);

    const exported = data((await parsed("?scope=sessions,replay,todos")).body);
    expect(exported.counts).toEqual({ sessions: 0, messages: 0, parts: 0, todos: 0 });
    expect(exported.sessions).toEqual([]);
    expect(exported.replays).toEqual([]);
    expect(exported.todos).toEqual({ sessions: [], rollup: { pending: 0, inProgress: 0, completed: 0, unknown: 0 } });
  });

  it.each([
    "?scope=accounts",
    "?preview=true",
    "?from=2024-02-30",
    "?to=01-01-2024",
    "?from=2024-02-02&to=2024-02-01",
    "?tz=Not%2FAZone",
  ])("rejects invalid scope/range/timezone input: %s", async (query) => {
    const { response, body } = await parsed(query);
    expect(response.status).toBe(400);
    expect("error" in body && body.error.code).toMatch(/^invalid_/);
  });

  it("returns honest database-not-found and schema-mismatch responses without using the default DB", async () => {
    resetConnectionForTests();
    connectionOverride.value = { ok: false, reason: "not-found", searched: [join(dir, "absent.db")] };
    const missing = await parsed("?preview=1");
    expect(missing.response.status).toBe(404);
    expect("error" in missing.body && missing.body.error.code).toBe("database_not_found");

    const mismatchPath = join(dir, "mismatch.db");
    const mismatch = new DatabaseSync(mismatchPath);
    mismatch.exec("CREATE TABLE project (id TEXT PRIMARY KEY)");
    mismatch.close();
    useDb(mismatchPath);
    const unsupported = await parsed("?preview=1");
    expect(unsupported.response.status).toBe(409);
    expect("error" in unsupported.body && unsupported.body.error.code).toBe("schema_mismatch");
  });
});

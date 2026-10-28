import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";
import { resetConnectionForTests } from "@/lib/db/connection";
import type { SessionTransfer } from "@/lib/queries/session-transfer";
import {
  buildMixedFixture,
  buildV2Fixture,
  LEGACY_ONLY_SESSION,
  MIGRATED_SESSION,
  V2_CHILD_SESSION,
  V2_MAIN_SESSION,
  V2_MAIN_TOKENS,
  V2_MODEL,
  V2_PROJECT_ID,
} from "@/test/fixtures/v2-fixture";

import { dynamic, GET } from "./route";

const dir = makeTempDir();
const originalDb = process.env.OC_LENS_DB;
const paths = { v1: join(dir, "v1.db"), v2: join(dir, "v2.db"), mixed: join(dir, "mixed.db") };

function use(path: string): void {
  process.env.OC_LENS_DB = path;
  resetConnectionForTests();
}

function call(id: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/sessions/${encodeURIComponent(id)}/opencode-export`), { params: Promise.resolve({ id }) });
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

beforeAll(() => {
  createFullSchemaDb(paths.v1);
  const db = new DatabaseSync(paths.v1);
  db.prepare("INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('ses_v1', 'global', 's', '/', 't', '1.17.7', 1, 1)").run();
  db.close();
  buildV2Fixture(paths.v2);
  buildMixedFixture(paths.mixed);
});

afterEach(() => resetConnectionForTests());

afterAll(() => {
  if (originalDb === undefined) delete process.env.OC_LENS_DB;
  else process.env.OC_LENS_DB = originalDb;
  resetConnectionForTests();
  cleanupTempDir(dir);
});

describe("GET /api/sessions/[id]/opencode-export", () => {
  it("serves opencode's SessionTransfer.Data shape as a download", async () => {
    use(paths.v2);
    const response = await call(V2_MAIN_SESSION);

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="opencode-session-${V2_MAIN_SESSION}.json"`);
    const body = (await response.json()) as SessionTransfer;
    expect(Object.keys(body).sort()).toEqual(["info", "messages"]);
    expect(body.info).toEqual({
      id: V2_MAIN_SESSION,
      projectID: V2_PROJECT_ID,
      agent: "build",
      model: V2_MODEL,
      cost: 0,
      tokens: { input: V2_MAIN_TOKENS.input, output: V2_MAIN_TOKENS.output, reasoning: V2_MAIN_TOKENS.reasoning, cache: { read: V2_MAIN_TOKENS.cacheRead, write: V2_MAIN_TOKENS.cacheWrite } },
      time: expect.objectContaining({ created: expect.any(Number), updated: expect.any(Number) }),
      title: "Fix the build",
      location: { directory: "/w/alpha" },
    });
  });

  it("emits every session_message row in seq order with id and type restored", async () => {
    use(paths.v2);
    const body = (await (await call(V2_MAIN_SESSION)).json()) as SessionTransfer;
    const db = new DatabaseSync(paths.v2, { readOnly: true });
    const rows = db.prepare("SELECT id, type, data FROM session_message WHERE session_id = ? ORDER BY seq").all(V2_MAIN_SESSION) as Array<{ id: string; type: string; data: string }>;
    db.close();

    expect(body.messages).toEqual(rows.map((row) => ({ ...(JSON.parse(row.data) as object), id: row.id, type: row.type })));
    expect(body.messages.some((message) => message.type === "idle" || message.type === "system" || message.type === "agent-switched")).toBe(true);
  });

  it("keeps a subagent's parentID so opencode can link it on import", async () => {
    use(paths.v2);
    const body = (await (await call(V2_CHILD_SESSION)).json()) as SessionTransfer;
    expect(body.info.parentID).toBe(V2_MAIN_SESSION);
    expect(body.info).not.toHaveProperty("title");
  });

  it("exports a migrated session from its 2.x copy, including the migration's own rows", async () => {
    use(paths.mixed);
    const body = (await (await call(MIGRATED_SESSION)).json()) as SessionTransfer;
    expect(body.messages.map((message) => message.id)).toContain("msg_old_sys");
  });

  it("explains why a session without a 2.x record cannot be exported", async () => {
    use(paths.mixed);
    const legacyOnly = await call(LEGACY_ONLY_SESSION);
    expect(legacyOnly.status).toBe(409);
    expect(await errorCode(legacyOnly)).toBe("export_unavailable");

    use(paths.v1);
    const v1 = await call("ses_v1");
    expect(v1.status).toBe(409);
    expect(await errorCode(v1)).toBe("export_unavailable");
  });

  it("404s an unknown session and 400s an invalid id", async () => {
    use(paths.v2);
    expect((await call("ses_missing")).status).toBe(404);
    expect((await call("bad\u0000id")).status).toBe(400);
  });
});

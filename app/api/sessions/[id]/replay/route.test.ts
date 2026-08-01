import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as connectionModule from "@/lib/db/connection";
import { resetConnectionForTests } from "@/lib/db/connection";
import { cleanupTempDir, makeTempDir } from "@/lib/db/__tests__/test-db";
import { LONG_SESSION_MESSAGE_COUNT, POPULATED_DB_PATH } from "@/test/fixtures";
import { EMPTY_DB_PATH } from "@/test/fixtures/paths";
import type { SessionReplayRouteResponse } from "@/types/oc";

import { dynamic, GET } from "./route";

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function body(response: Response): Promise<SessionReplayRouteResponse> {
  return response.json() as Promise<SessionReplayRouteResponse>;
}

describe("GET /api/sessions/[id]/replay", () => {
  let originalDb: string | undefined;
  let originalConfigHome: string | undefined;
  let directory: string;
  let populatedCopy: string;
  let emptyCopy: string;

  beforeEach(() => {
    directory = makeTempDir();
    populatedCopy = join(directory, "populated.db");
    emptyCopy = join(directory, "empty.db");
    copyFileSync(POPULATED_DB_PATH, populatedCopy);
    copyFileSync(EMPTY_DB_PATH, emptyCopy);
    originalDb = process.env.OC_LENS_DB;
    originalConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.OC_LENS_DB = populatedCopy;
    process.env.XDG_CONFIG_HOME = join(directory, "config");
    resetConnectionForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetConnectionForTests();
    if (originalDb === undefined) delete process.env.OC_LENS_DB;
    else process.env.OC_LENS_DB = originalDb;
    if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalConfigHome;
    cleanupTempDir(directory);
  });

  it("is dynamic and returns the 400-message fixture in deterministic response order under 500 ms", async () => {
    const db = new DatabaseSync(populatedCopy, { readOnly: true });
    const longSession = db.prepare("SELECT id FROM session ORDER BY id LIMIT 1").get() as { id: string };
    const expectedMessages = db
      .prepare("SELECT id FROM message WHERE session_id = ? ORDER BY time_created, id")
      .all(longSession.id) as Array<{ id: string }>;
    const expectedParts = db
      .prepare("SELECT id, message_id FROM part WHERE session_id = ? ORDER BY time_created, id")
      .all(longSession.id) as Array<{ id: string; message_id: string }>;
    db.close();

    const started = performance.now();
    const response = await GET(new Request(`http://localhost/api/sessions/${longSession.id}/replay`), context(longSession.id));
    const elapsed = performance.now() - started;
    const payload = await body(response);

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(500);
    expect("data" in payload && payload.data.turns).toHaveLength(LONG_SESSION_MESSAGE_COUNT);
    if (!("data" in payload)) throw new Error("expected replay envelope");
    expect(payload.data.turns.map((turn) => turn.messageId)).toEqual(expectedMessages.map((message) => message.id));
    for (const turn of payload.data.turns) {
      expect(turn.parts.map((part) => part.id)).toEqual(
        expectedParts.filter((part) => part.message_id === turn.messageId).map((part) => part.id),
      );
    }
    expect(payload.data.tokenAccumulation.map((point) => point.atTurnIndex)).toEqual(
      Array.from({ length: LONG_SESSION_MESSAGE_COUNT }, (_, index) => index),
    );
    expect(payload.meta.schemaVersion).toBe("opencode-1.17.7");
  });

  it("keeps unknown part types in the response and reports their decoder warning", async () => {
    const db = new DatabaseSync(populatedCopy, { readOnly: true });
    const row = db.prepare("SELECT session_id FROM part WHERE data LIKE '%fixture-unknown-part-type%' LIMIT 1").get() as
      | { session_id: string }
      | undefined;
    db.close();
    expect(row).toBeDefined();

    const response = await GET(new Request("http://localhost/replay"), context(row!.session_id));
    const payload = await body(response);
    if (!("data" in payload)) throw new Error("expected replay envelope");

    expect(payload.data.turns.flatMap((turn) => turn.parts).some((part) => part.data.type === "unknown")).toBe(true);
    expect(payload.meta.warnings.some((warning) => warning.code.includes("unknown"))).toBe(true);
  });

  it("returns a 404 envelope for a missing session", async () => {
    const response = await GET(new Request("http://localhost/replay"), context("ses_missing"));
    expect(response.status).toBe(404);
    expect(await body(response)).toEqual({
      error: { code: "session_not_found", message: "Session ses_missing was not found." },
    });
  });

  it("returns the same honest 404 session state for an empty database", async () => {
    process.env.OC_LENS_DB = emptyCopy;
    resetConnectionForTests();
    const response = await GET(new Request("http://localhost/replay"), context("ses_0000"));
    expect(response.status).toBe(404);
    expect(await body(response)).toEqual({
      error: { code: "session_not_found", message: "Session ses_0000 was not found." },
    });
  });

  it("rejects invalid route params before opening the database", async () => {
    process.env.OC_LENS_DB = "/missing.db";
    resetConnectionForTests();
    const response = await GET(new Request("http://localhost/replay"), context(""));
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({
      error: { code: "invalid_session_id", message: "The session id is invalid." },
    });
  });

  it("returns explicit database-not-found and schema-mismatch envelopes", async () => {
    resetConnectionForTests();
    const connection = vi.spyOn(connectionModule, "getConnection");
    connection.mockReturnValueOnce({ ok: false, reason: "not-found", searched: ["/missing/oc-lens-replay.db"] });
    const missing = await GET(new Request("http://localhost/replay"), context("ses_0000"));
    expect(missing.status).toBe(404);
    expect(await body(missing)).toEqual({
      error: {
        code: "database_not_found",
        message: "No opencode database was found. Check the database location in Settings.",
      },
    });

    connection.mockReturnValueOnce({
      ok: false,
      reason: "schema-mismatch",
      mismatch: { table: "session", missingColumns: ["tokens_input"] },
    });
    const mismatch = await GET(new Request("http://localhost/replay"), context("ses_0000"));
    expect(mismatch.status).toBe(409);
    expect(await body(mismatch)).toEqual({
      error: {
        code: "schema_mismatch",
        message: "The opencode database schema is not supported by this version of oc-lens.",
      },
    });
  });
});

import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as connectionModule from "@/lib/db/connection";
import { cleanupTempDir, makeTempDir } from "@/lib/db/__tests__/test-db";
import { schemaVersion } from "@/lib/db/schema-guard";
import { POPULATED_DB_PATH } from "@/test/fixtures";
import { FIXTURE_SCHEMA_SQL } from "@/test/fixtures/schema";
import type { SkillsRouteResponse } from "@/types/oc";
import { dynamic, GET } from "./route";

async function body(response: Response): Promise<SkillsRouteResponse> {
  return response.json() as Promise<SkillsRouteResponse>;
}

function insertSession(db: DatabaseSync, id: string, time: number): void {
  db.prepare(
    "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (?, 'global', ?, '/', ?, '1', ?, ?)",
  ).run(id, id, id, time, time);
}

function insertSkill(db: DatabaseSync, id: string, sessionId: string, time: number, input: unknown, status = "completed", start = 0, end = 10): void {
  db.prepare(
    "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, `message-${id}`, sessionId, time, time, JSON.stringify({
    type: "tool",
    tool: "skill",
    callID: `call-${id}`,
    state: { status, input, time: { start, end } },
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/skills", () => {
  it("returns all five fixture skills with exact counts, errors, and duration percentiles", async () => {
    const dir = makeTempDir();
    const path = join(dir, "populated.db");
    copyFileSync(POPULATED_DB_PATH, path);
    const db = new DatabaseSync(path, { readOnly: true });
    vi.spyOn(connectionModule, "getConnection").mockReturnValue({ ok: true, db });
    try {
      const response = await GET(new Request("http://localhost/api/skills?range=all"));
      const result = await body(response);

      expect(dynamic).toBe("force-dynamic");
      expect(response.status).toBe(200);
      expect(result).toEqual({
        data: [
          { skill: "code-review", totalCalls: 38, sessionCount: 35, errorCount: 6, p50DurationMs: 1603, p95DurationMs: 3811 },
          { skill: "changelog-writer", totalCalls: 37, sessionCount: 34, errorCount: 3, p50DurationMs: 1413, p95DurationMs: 3148 },
          { skill: "deploy-helper", totalCalls: 37, sessionCount: 34, errorCount: 2, p50DurationMs: 1989, p95DurationMs: 3891 },
          { skill: "docs-sync", totalCalls: 37, sessionCount: 34, errorCount: 3, p50DurationMs: 1600, p95DurationMs: 3597 },
          { skill: "test-runner", totalCalls: 37, sessionCount: 34, errorCount: 1, p50DurationMs: 1817, p95DurationMs: 3738 },
        ],
        meta: {
          generatedAt: expect.any(Number),
          schemaVersion,
          warnings: [{
            code: "unknown-part-type",
            count: 1,
            message: "Unrecognised part.data.type: fixture-unknown-part-type",
          }],
        },
      });
    } finally {
      db.close();
      cleanupTempDir(dir);
    }
  });

  it("keeps unknown input and applies the selected time range", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    const now = Date.UTC(2026, 7, 1, 12);
    const recent = now - 2 * 24 * 60 * 60 * 1_000;
    const old = now - 10 * 24 * 60 * 60 * 1_000;
    insertSession(db, "recent", recent);
    insertSession(db, "old", old);
    insertSkill(db, "unknown", "recent", recent, {}, "error", 10, 40);
    insertSkill(db, "old", "old", old, { name: "old-skill" }, "completed", 1, 2);
    vi.spyOn(connectionModule, "getConnection").mockReturnValue({ ok: true, db });
    vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const recentResult = await body(await GET(new Request("http://localhost/api/skills?range=7d")));
      const allResult = await body(await GET(new Request("http://localhost/api/skills?range=all")));

      expect("data" in recentResult && recentResult.data).toEqual([
        { skill: "unknown", totalCalls: 1, sessionCount: 1, errorCount: 1, p50DurationMs: 30, p95DurationMs: 30 },
      ]);
      expect("data" in allResult && allResult.data.map((skill) => skill.skill)).toEqual(["old-skill", "unknown"]);
    } finally {
      db.close();
    }
  });

  it("returns a clean empty payload and rejects invalid ranges before database access", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    const connection = vi.spyOn(connectionModule, "getConnection").mockReturnValue({ ok: true, db });
    try {
      const empty = await body(await GET(new Request("http://localhost/api/skills?range=all")));
      expect(empty).toMatchObject({ data: [], meta: { schemaVersion, warnings: [] } });

      connection.mockClear();
      const invalid = await GET(new Request("http://localhost/api/skills?range=year"));
      expect(invalid.status).toBe(400);
      expect(await body(invalid)).toEqual({
        error: { code: "invalid_range", message: "Range must be one of 7d, 30d, 90d, or all." },
      });
      expect(connection).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("returns sanitized database and schema states", async () => {
    vi.spyOn(connectionModule, "getConnection").mockReturnValueOnce({
      ok: false,
      reason: "not-found",
      searched: ["/private/opencode.db"],
    }).mockReturnValueOnce({
      ok: false,
      reason: "schema-mismatch",
      mismatch: { table: "part", missingColumns: ["data"] },
    });

    const missing = await GET(new Request("http://localhost/api/skills"));
    const missingText = await missing.text();
    const mismatch = await GET(new Request("http://localhost/api/skills"));

    expect(missing.status).toBe(404);
    expect(missingText).not.toContain("/private");
    expect(mismatch.status).toBe(409);
    expect(await body(mismatch)).toEqual({
      error: { code: "schema_mismatch", message: `The opencode database schema is not supported by ${schemaVersion}.` },
    });
  });
});

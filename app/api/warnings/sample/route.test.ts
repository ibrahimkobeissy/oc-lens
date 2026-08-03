import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as connectionModule from "@/lib/db/connection";
import { cleanupTempDir, makeTempDir } from "@/lib/db/__tests__/test-db";
import { POPULATED_DB_PATH } from "@/test/fixtures";
import { dynamic, GET } from "./route";

interface Body {
  data?: { code: string; found: boolean; sourceId: string | null; raw: string | null; truncated: boolean };
  error?: { code: string; message: string };
}

async function body(response: Response): Promise<Body> {
  return response.json() as Promise<Body>;
}

async function withFixtureDb<T>(run: (db: DatabaseSync) => Promise<T>): Promise<T> {
  const dir = makeTempDir();
  try {
    const path = join(dir, "populated.db");
    copyFileSync(POPULATED_DB_PATH, path);
    const db = new DatabaseSync(path, { readOnly: true });
    vi.spyOn(connectionModule, "getConnection").mockReturnValue({ ok: true, db });
    try {
      return await run(db);
    } finally {
      db.close();
    }
  } finally {
    cleanupTempDir(dir);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/warnings/sample", () => {
  it("is dynamic, never statically captured against a live database", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("requires a code query parameter", async () => {
    const response = await GET(new Request("http://localhost/api/warnings/sample"));
    expect(response.status).toBe(400);
    expect((await body(response)).error?.code).toBe("invalid_query");
  });

  it("finds a real part row for the fixture's deliberate unknown part type", async () => {
    await withFixtureDb(async () => {
      const response = await GET(new Request("http://localhost/api/warnings/sample?code=unknown-part-type"));
      const result = await body(response);
      expect(result.data?.found).toBe(true);
      expect(result.data?.sourceId).toMatch(/^prt_/);
      expect(result.data?.raw).toContain("fixture-unknown-part-type");
    });
  });

  it("finds a real message row for the fixture's deliberate malformed JSON", async () => {
    await withFixtureDb(async () => {
      const response = await GET(new Request("http://localhost/api/warnings/sample?code=malformed-message-data"));
      const result = await body(response);
      expect(result.data?.found).toBe(true);
      expect(result.data?.sourceId).toMatch(/^msg_/);
      expect(result.data?.raw).toBe("{not valid json");
    });
  });

  it("reports found:false, not an error, when no row matches the requested code", async () => {
    await withFixtureDb(async () => {
      const response = await GET(new Request("http://localhost/api/warnings/sample?code=malformed-compaction"));
      const result = await body(response);
      expect(response.status).toBe(200);
      expect(result.data).toEqual({ code: "malformed-compaction", found: false, sourceId: null, raw: null, truncated: false });
    });
  });

  it("reports found:false for a code this endpoint doesn't recognise at all, rather than scanning every table", async () => {
    await withFixtureDb(async () => {
      const response = await GET(new Request("http://localhost/api/warnings/sample?code=unknown-agent"));
      const result = await body(response);
      expect(result.data?.found).toBe(false);
    });
  });
});

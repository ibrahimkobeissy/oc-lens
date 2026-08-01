import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanupTempDir, makeTempDir } from "@/lib/db/__tests__/test-db";
import * as locateModule from "@/lib/db/locate";
import { schemaVersion } from "@/lib/db/schema-guard";
import { dynamic, GET } from "./route";

describe("GET /api/storage", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanupTempDir(dir);
  });

  it("returns an exact, read-only breakdown without exposing a path", async () => {
    const dbPath = join(dir, "opencode.db");
    writeFileSync(dbPath, "d".repeat(100));
    writeFileSync(`${dbPath}-wal`, "w".repeat(20));
    mkdirSync(join(dir, "log"));
    writeFileSync(join(dir, "log", "one.log"), "l".repeat(30));
    mkdirSync(join(dir, "repos", "nested"), { recursive: true });
    writeFileSync(join(dir, "repos", "nested", "repo"), "r".repeat(40));
    vi.spyOn(locateModule, "locateDb").mockReturnValue({ found: true, path: dbPath });

    const response = await GET();
    const body: unknown = await response.json();

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: { dbBytes: 100, walBytes: 20, logBytes: 30, reposBytes: 40, totalBytes: 190 },
      meta: { generatedAt: expect.any(Number), schemaVersion, warnings: [] },
    });
    expect(JSON.stringify(body)).not.toContain(dir);
  });

  it("preserves null for missing directories instead of reporting zero bytes", async () => {
    const dbPath = join(dir, "opencode.db");
    writeFileSync(dbPath, "db");
    vi.spyOn(locateModule, "locateDb").mockReturnValue({ found: true, path: dbPath });

    const response = await GET();
    const body = await response.json() as { data: Record<string, unknown> };

    expect(body.data).toMatchObject({ dbBytes: 2, walBytes: 0, logBytes: null, reposBytes: null, totalBytes: 2 });
  });

  it("returns a sanitized not-found response without searched private paths", async () => {
    const privatePath = join(dir, "private", "opencode.db");
    vi.spyOn(locateModule, "locateDb").mockReturnValue({ found: false, searched: [privatePath] });

    const response = await GET();
    const text = await response.text();

    expect(response.status).toBe(404);
    expect(JSON.parse(text)).toEqual({
      error: { code: "database_not_found", message: "No opencode database was found. Check the database location in Settings." },
    });
    expect(text).not.toContain(privatePath);
  });

  it("sanitizes filesystem failures", async () => {
    const dbPath = join(dir, "opencode.db");
    writeFileSync(dbPath, "db");
    writeFileSync(join(dir, "log"), "not-a-directory");
    vi.spyOn(locateModule, "locateDb").mockReturnValue({ found: true, path: dbPath });

    const response = await GET();
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      error: { code: "storage_unavailable", message: "The opencode storage footprint could not be measured." },
    });
    expect(text).not.toContain(dbPath);
  });
});

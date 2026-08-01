import { copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetConnectionForTests } from "@/lib/db/connection";
import { POPULATED_DB_PATH } from "@/test/fixtures";
import { dynamic, GET } from "./route";

describe("GET /api/search", () => {
  let dbPath: string;
  let originalDb: string | undefined;

  beforeEach(() => {
    originalDb = process.env.OC_LENS_DB;
    dbPath = join(tmpdir(), `oc-lens-search-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
    copyFileSync(POPULATED_DB_PATH, dbPath);
    process.env.OC_LENS_DB = dbPath;
    resetConnectionForTests();
  });

  afterEach(() => {
    resetConnectionForTests();
    if (originalDb === undefined) delete process.env.OC_LENS_DB;
    else process.env.OC_LENS_DB = originalDb;
    rmSync(dbPath, { force: true });
  });

  it("is dynamic, finds an exact fixture slug, caps results, and stays responsive", async () => {
    const db = new DatabaseSync(dbPath);
    const slug = (db.prepare("SELECT slug FROM session ORDER BY id LIMIT 1").get() as { slug: string }).slug;
    db.close();
    const started = performance.now();
    const response = await GET(new Request(`http://localhost/api/search?q=${encodeURIComponent(slug)}`));
    const elapsed = performance.now() - started;
    const body = await response.json();

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(500);
    expect(body.data.sessions.some((session: { slug: string }) => session.slug === slug)).toBe(true);
    expect(body.data.sessions.length).toBeLessThanOrEqual(20);
    expect(body.data.projects.length).toBeLessThanOrEqual(20);
  });

  it("returns clean empty results for gibberish", async () => {
    const response = await GET(new Request("http://localhost/api/search?q=definitely-no-such-oc-lens-record-987654"));
    expect(await response.json()).toMatchObject({
      data: { sessions: [], projects: [], totals: { sessions: 0, projects: 0 } },
    });
  });

  it("treats SQL wildcard characters as literal search text", async () => {
    const db = new DatabaseSync(dbPath);
    db.prepare("INSERT INTO project (id, worktree, name, time_created, time_updated, sandboxes) VALUES ('literal_project', '/tmp/literal_project', 'Percent%_Project', 1, 1, '[]')").run();
    db.prepare("INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('literal_session', 'literal_project', 'literal_%_slug', '/', 'Literal %_ title', '1', 1, 1)").run();
    db.close();
    resetConnectionForTests();

    const response = await GET(new Request("http://localhost/api/search?q=%25_"));
    const body = await response.json();

    expect(body.data.sessions.map((session: { id: string }) => session.id)).toEqual(["literal_session"]);
    expect(body.data.projects.map((project: { id: string }) => project.id)).toEqual(["literal_project"]);
  });

  it("rejects overlong queries before searching", async () => {
    const response = await GET(new Request(`http://localhost/api/search?q=${"x".repeat(201)}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_query", message: "Search queries must be 200 characters or fewer" },
    });
  });
});

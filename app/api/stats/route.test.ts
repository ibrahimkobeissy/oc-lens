import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as connectionModule from "@/lib/db/connection";
import { resetConnectionForTests } from "@/lib/db/connection";
import { EMPTY_DB_PATH, POPULATED_DB_PATH } from "@/test/fixtures";
import { FIXTURE_SCHEMA_SQL } from "@/test/fixtures/schema";
import { GET } from "./route";

describe("OCL-030 GET /api/stats", () => {
  let configHome: string;
  let populatedCopy: string;
  let emptyCopy: string;
  const originalDb = process.env.OC_LENS_DB;
  const originalConfig = process.env.XDG_CONFIG_HOME;

  beforeEach(() => {
    configHome = mkdtempSync(join(tmpdir(), "oc-lens-stats-"));
    populatedCopy = join(configHome, "populated.db");
    emptyCopy = join(configHome, "empty.db");
    copyFileSync(POPULATED_DB_PATH, populatedCopy);
    copyFileSync(EMPTY_DB_PATH, emptyCopy);
    process.env.XDG_CONFIG_HOME = configHome;
    resetConnectionForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetConnectionForTests();
    if (originalDb === undefined) delete process.env.OC_LENS_DB; else process.env.OC_LENS_DB = originalDb;
    if (originalConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = originalConfig;
    rmSync(configHome, { recursive: true, force: true });
  });

  it("returns the exact overview shape, unpriced costs, range changes, and stays under 400ms", async () => {
    process.env.OC_LENS_DB = populatedCopy;
    const started = performance.now();
    const allResponse = await GET(new Request("http://localhost/api/stats?range=all&tz=UTC"));
    const elapsed = performance.now() - started;
    const all = await allResponse.json();
    expect(allResponse.status).toBe(200);
    expect(all.data).toMatchObject({ totalSessions: 126, totalCost: { priced: false }, unknownAgentCount: 10, unknownModelCount: 10 });
    expect(all.data).toHaveProperty("dailyActivity");
    expect(all.data).toHaveProperty("dailyTokens");
    expect(all.data).toHaveProperty("hourOfDay");
    expect(all.data).toHaveProperty("costBreakdown");
    expect(elapsed).toBeLessThan(400);

    resetConnectionForTests();
    const rangedResponse = await GET(new Request("http://localhost/api/stats?range=7d&tz=Pacific%2FAuckland"));
    const ranged = await rangedResponse.json();
    expect(ranged.data.totalSessions).toBeLessThan(all.data.totalSessions);
    expect(ranged.data.dailyActivity).not.toEqual(all.data.dailyActivity);
  });

  it("returns a valid empty shape", async () => {
    process.env.OC_LENS_DB = emptyCopy;
    const response = await GET(new Request("http://localhost/api/stats?range=all&tz=Europe%2FParis"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.totalSessions).toBe(0);
    expect(body.data.totalMessages).toBe(0);
    expect(body.data.totalCost).toEqual({ amount: 0, priced: false });
    expect(body.data.modelBreakdown).toEqual([]);
    expect(body.data.projectBreakdown).toEqual([]);
    expect(body.data.dailyTokens).toEqual([]);
  });

  it("counts in-range messages from sessions that started before the range", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    const now = Date.UTC(2026, 7, 1, 12);
    const sessionTime = now - 10 * 86_400_000;
    const messageTime = now - 86_400_000;
    db.prepare("INSERT INTO project (id, worktree, name) VALUES ('global', '/', NULL)").run();
    db.prepare(
      "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('crossing', 'global', 'crossing', '/', 'Crossing', '1', ?, ?)",
    ).run(sessionTime, messageTime);
    db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('recent', 'crossing', ?, ?, ?)")
      .run(messageTime, messageTime, JSON.stringify({
        role: "assistant",
        providerID: "provider",
        modelID: "model",
        tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: messageTime, completed: messageTime },
      }));
    db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('bad', 'recent', 'crossing', ?, ?, '{')")
      .run(messageTime, messageTime);
    vi.spyOn(connectionModule, "getConnection").mockReturnValue({ ok: true, db });
    vi.spyOn(Date, "now").mockReturnValue(now);

    const response = await GET(new Request("http://localhost/api/stats?range=7d&tz=UTC"));
    const payload = await response.json();

    expect(payload.data.totalSessions).toBe(0);
    expect(payload.data.totalMessages).toBe(1);
    expect(payload.data.dailyActivity.reduce((sum: number, day: { messageCount: number }) => sum + day.messageCount, 0)).toBe(1);
    expect(payload.data.modelBreakdown).toEqual([
      expect.objectContaining({ providerID: "provider", modelID: "model", messageCount: 1 }),
    ]);
    expect(payload.data.projectBreakdown).toEqual([
      expect.objectContaining({ id: "global", sessionCount: 0, messageCount: 1 }),
    ]);
    expect(payload.meta.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "malformed-part-data", count: 1 }),
      expect.objectContaining({ code: "unknown-part-type", count: 1 }),
    ]));
    expect(payload.meta.warnings.every((warning: { count: number }) => warning.count === 1)).toBe(true);
    db.close();
  });

  it("scopes storedCostComparison to the requested range instead of returning the all-time figure (code-review-2026-08-02.md M1)", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    const now = Date.UTC(2026, 7, 1, 12);
    const inRangeTime = now - 3 * 86_400_000;
    const outOfRangeTime = now - 40 * 86_400_000;
    db.prepare("INSERT INTO project (id, worktree, name) VALUES ('global', '/', NULL)").run();
    db.prepare(
      "INSERT INTO session (id, project_id, slug, directory, title, version, cost, time_created, time_updated) VALUES ('recent', 'global', 'recent', '/', 'Recent', '1', 1.5, ?, ?)",
    ).run(inRangeTime, inRangeTime);
    db.prepare(
      "INSERT INTO session (id, project_id, slug, directory, title, version, cost, time_created, time_updated) VALUES ('old', 'global', 'old', '/', 'Old', '1', 2.5, ?, ?)",
    ).run(outOfRangeTime, outOfRangeTime);
    vi.spyOn(connectionModule, "getConnection").mockReturnValue({ ok: true, db });
    vi.spyOn(Date, "now").mockReturnValue(now);

    const rangedPayload = await (await GET(new Request("http://localhost/api/stats?range=7d&tz=UTC"))).json();
    expect(rangedPayload.data.storedCostComparison).toBe(1.5);
    expect(rangedPayload.data.costBreakdown.storedCostComparison).toBe(1.5);

    const allPayload = await (await GET(new Request("http://localhost/api/stats?range=all&tz=UTC"))).json();
    expect(allPayload.data.storedCostComparison).toBe(4);
    expect(allPayload.data.costBreakdown.storedCostComparison).toBe(4);

    // A custom picked range (from/to) overrides the named range and needs no `range` param at all.
    const customFrom = outOfRangeTime - 1;
    const customPayload = await (await GET(new Request(`http://localhost/api/stats?from=${customFrom}&to=${outOfRangeTime + 1}&tz=UTC`))).json();
    expect(customPayload.data.storedCostComparison).toBe(2.5);

    expect((await GET(new Request("http://localhost/api/stats?from=100&to=50&tz=UTC"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/stats?from=notanumber&to=100&tz=UTC"))).status).toBe(400);
    db.close();
  });

  it("rejects invalid range and timezone", async () => {
    expect((await GET(new Request("http://localhost/api/stats?range=1y"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/stats?tz=not-a-zone"))).status).toBe(400);
  });

  it("returns the typed error envelope when database access throws", async () => {
    vi.spyOn(connectionModule, "getConnection").mockImplementation(() => { throw new Error("private detail"); });
    const response = await GET(new Request("http://localhost/api/stats"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "stats_failed", message: "Statistics could not be read from the opencode database." },
    });
  });
});

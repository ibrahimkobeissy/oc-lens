import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as connectionModule from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { FIXTURE_SCHEMA_SQL } from "@/test/fixtures/schema";
import type { ActivityRouteResponse } from "@/types/oc";
import { dynamic, GET } from "./route";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(FIXTURE_SCHEMA_SQL);
  return db;
}

async function body(response: Response): Promise<ActivityRouteResponse> {
  return (await response.json()) as ActivityRouteResponse;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/activity", () => {
  it("is force-dynamic and returns the populated contract in the requested timezone", async () => {
    const db = database();
    const at = Date.UTC(2026, 0, 2, 23, 30);
    db.prepare(
      "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (?, 'global', 'late', '/', 'Late', '1', ?, ?)",
    ).run("late", at, at);
    db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)").run(
      "message",
      "late",
      at,
      at,
      JSON.stringify({ role: "user", time: { created: at } }),
    );
    db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)").run(
      "tool",
      "message",
      "late",
      at,
      at,
      JSON.stringify({ type: "tool", tool: "read", callID: "call", state: { status: "completed", input: {} } }),
    );
    vi.spyOn(connectionModule, "getConnection").mockReturnValue({ ok: true, db });

    const response = await GET(new Request("http://localhost/api/activity?range=all&tz=Pacific%2FAuckland"));
    const result = await body(response);

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      data: {
        dailyActivity: [{ date: "2026-01-03", sessionCount: 1, messageCount: 1, toolCallCount: 1 }],
        streaks: { totalActiveDays: 1, firstSessionDate: "2026-01-03" },
      },
      meta: { schemaVersion, warnings: [] },
    });
    if ("data" in result) {
      expect(result.data.hourOfDay).toHaveLength(24);
      expect(result.data.hourOfDay[12]).toEqual({ hour: 12, count: 1 });
      expect(result.data.dayOfWeek).toHaveLength(7);
      expect(result.data.dayOfWeek[6]).toEqual({ day: 6, count: 1 });
    }
    db.close();
  });

  it("changes calendar bucketing across two timezones", async () => {
    const db = database();
    const at = Date.UTC(2026, 0, 2, 23, 30);
    db.prepare(
      "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('late', 'global', 'late', '/', 'Late', '1', ?, ?)",
    ).run(at, at);
    vi.spyOn(connectionModule, "getConnection").mockReturnValue({ ok: true, db });

    const utc = await body(await GET(new Request("http://localhost/api/activity?range=all&tz=UTC")));
    const auckland = await body(await GET(new Request("http://localhost/api/activity?range=all&tz=Pacific%2FAuckland")));

    expect("data" in utc && utc.data.dailyActivity[0]?.date).toBe("2026-01-02");
    expect("data" in auckland && auckland.data.dailyActivity[0]?.date).toBe("2026-01-03");
    db.close();
  });

  it("applies the requested range to activity buckets", async () => {
    const db = database();
    const now = Date.UTC(2026, 1, 1, 12);
    const recent = now - 2 * 24 * 60 * 60 * 1_000;
    const old = now - 10 * 24 * 60 * 60 * 1_000;
    const insert = db.prepare(
      "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (?, 'global', ?, '/', ?, '1', ?, ?)",
    );
    insert.run("recent", "recent", "Recent", recent, recent);
    insert.run("old", "old", "Old", old, old);
    vi.spyOn(connectionModule, "getConnection").mockReturnValue({ ok: true, db });
    vi.spyOn(Date, "now").mockReturnValue(now);

    const sevenDays = await body(await GET(new Request("http://localhost/api/activity?range=7d&tz=UTC")));
    const all = await body(await GET(new Request("http://localhost/api/activity?range=all&tz=UTC")));

    expect("data" in sevenDays && sevenDays.data.dailyActivity.map((day) => day.date)).toEqual(["2026-01-30"]);
    expect("data" in all && all.data.dailyActivity.map((day) => day.date)).toEqual(["2026-01-22", "2026-01-30"]);
    expect("data" in sevenDays && sevenDays.data.streaks.totalActiveDays).toBe(1);
    expect("data" in sevenDays && sevenDays.data.streaks.firstSessionDate).toBe("2026-01-30");
    expect("data" in all && all.data.streaks.totalActiveDays).toBe(2);
    expect("data" in all && all.data.streaks.firstSessionDate).toBe("2026-01-22");
    db.close();
  });

  it("returns a clean empty-shaped payload", async () => {
    const db = database();
    vi.spyOn(connectionModule, "getConnection").mockReturnValue({ ok: true, db });

    const response = await GET(new Request("http://localhost/api/activity?range=30d&tz=Europe%2FParis"));
    const result = await body(response);

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      data: {
        dailyActivity: [],
        streaks: {
          currentStreakDays: 0,
          longestStreakDays: 0,
          longestStreakStart: null,
          longestStreakEnd: null,
          mostActiveDay: null,
          totalActiveDays: 0,
          firstSessionDate: null,
        },
      },
      meta: { schemaVersion, warnings: [] },
    });
    if ("data" in result) {
      expect(result.data.hourOfDay).toEqual(Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 })));
      expect(result.data.dayOfWeek).toEqual(Array.from({ length: 7 }, (_, day) => ({ day, count: 0 })));
    }
    db.close();
  });

  it("surfaces decoder warnings without double-counting them", async () => {
    const db = database();
    db.prepare(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('bad', 'missing', 'missing', 1, 1, '{')",
    ).run();
    vi.spyOn(connectionModule, "getConnection").mockReturnValue({ ok: true, db });

    const result = await body(await GET(new Request("http://localhost/api/activity?range=all")));

    expect("data" in result && result.meta.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "malformed-part-data", count: 1 }),
      expect.objectContaining({ code: "unknown-part-type", count: 1 }),
    ]));
    if ("data" in result) {
      expect(result.meta.warnings.every((warning) => warning.count === 1)).toBe(true);
    }
    db.close();
  });

  it("returns honest not-found and schema-mismatch states", async () => {
    vi.spyOn(connectionModule, "getConnection").mockReturnValueOnce({
      ok: false,
      reason: "not-found",
      searched: ["/not/exposed/opencode.db"],
    }).mockReturnValueOnce({
      ok: false,
      reason: "schema-mismatch",
      mismatch: { table: "session", missingColumns: ["agent"] },
    });

    const missing = await GET(new Request("http://localhost/api/activity"));
    const mismatch = await GET(new Request("http://localhost/api/activity"));

    expect(missing.status).toBe(404);
    expect(await body(missing)).toEqual({
      error: { code: "database_not_found", message: "No opencode database was found. Check the database location in Settings." },
    });
    expect(mismatch.status).toBe(409);
    expect(await body(mismatch)).toEqual({
      error: { code: "schema_mismatch", message: `The opencode database schema is not supported by ${schemaVersion}.` },
    });
  });

  it("rejects invalid range and timezone without opening the database", async () => {
    const connection = vi.spyOn(connectionModule, "getConnection");

    const range = await GET(new Request("http://localhost/api/activity?range=year"));
    const timezone = await GET(new Request("http://localhost/api/activity?tz=Europe%2FNot_A_Zone"));

    expect(range.status).toBe(400);
    expect(await body(range)).toEqual({
      error: { code: "invalid_range", message: "Range must be one of 7d, 30d, 90d, or all." },
    });
    expect(timezone.status).toBe(400);
    expect(await body(timezone)).toEqual({
      error: { code: "invalid_timezone", message: "Timezone must be a valid IANA timezone." },
    });
    expect(connection).not.toHaveBeenCalled();
  });
});

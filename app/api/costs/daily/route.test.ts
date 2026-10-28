import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";
import { resetConnectionForTests } from "@/lib/db/connection";
import type { DailyUsageRow } from "@/lib/pricing/breakdown";
import { writePricing } from "@/lib/pricing/config";

import { dynamic, GET } from "./route";

const originalDb = process.env.OC_LENS_DB;
const originalConfigHome = process.env.XDG_CONFIG_HOME;
const dir = makeTempDir();
const configHome = join(dir, "config");
const dbPath = join(dir, "daily.db");

function assistant(modelID: string, input: number, output: number): string {
  return JSON.stringify({ role: "assistant", providerID: "provider", modelID, tokens: { input, output, reasoning: 10, cache: { read: 100, write: 1 } } });
}

async function rows(query: string): Promise<{ status: number; rows: DailyUsageRow[] }> {
  const response = await GET(new Request(`http://localhost/api/costs/daily${query}`));
  const body = (await response.json()) as { data?: DailyUsageRow[] };
  return { status: response.status, rows: body.data ?? [] };
}

beforeAll(() => {
  process.env.XDG_CONFIG_HOME = configHome;
  writePricing({ version: 1, prices: { "provider/priced": { inputPerMTok: 1, outputPerMTok: 2, cacheReadPerMTok: 0, cacheWritePerMTok: 0, currency: "USD" } }, updatedAt: 1 }, { configHome });
  createFullSchemaDb(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec("DELETE FROM part; DELETE FROM message;");
  const insert = db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, 'ses_1', ?, ?, ?)");
  const at = (day: number, hour: number) => Date.UTC(2024, 0, day, hour);
  insert.run("m1", at(1, 10), at(1, 10), assistant("priced", 1_000_000, 0));
  insert.run("m2", at(1, 23), at(1, 23), assistant("unpriced", 5, 5));
  insert.run("m3", at(2, 9), at(2, 9), assistant("priced", 0, 1_000_000));
  insert.run("m4", at(2, 9), at(2, 9), JSON.stringify({ role: "user", time: { created: at(2, 9) } }));
  db.close();
  process.env.OC_LENS_DB = dbPath;
  resetConnectionForTests();
});

afterAll(() => {
  resetConnectionForTests();
  if (originalDb === undefined) delete process.env.OC_LENS_DB;
  else process.env.OC_LENS_DB = originalDb;
  if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalConfigHome;
  cleanupTempDir(dir);
});

describe("GET /api/costs/daily", () => {
  it("returns tokens and priced/unpriced cost per day, newest first, skipping user turns", async () => {
    const { status, rows: days } = await rows("?range=all&tz=UTC");
    expect(dynamic).toBe("force-dynamic");
    expect(status).toBe(200);
    expect(days).toEqual([
      { date: "2024-01-02", messages: 1, tokens: { input: 0, output: 1_000_000, reasoning: 10, cacheRead: 100, cacheWrite: 1 }, pricedAmount: 2, unpricedMessages: 0 },
      { date: "2024-01-01", messages: 2, tokens: { input: 1_000_005, output: 5, reasoning: 20, cacheRead: 200, cacheWrite: 2 }, pricedAmount: 1, unpricedMessages: 1 },
    ]);
  });

  it("buckets by the requested time zone", async () => {
    const { rows: days } = await rows("?range=all&tz=Asia%2FTokyo");
    expect(days.map((day) => [day.date, day.messages])).toEqual([["2024-01-02", 2], ["2024-01-01", 1]]);
  });

  it("applies the rolling range and rejects invalid parameters", async () => {
    expect((await rows("?range=7d&tz=UTC")).rows).toEqual([]);
    expect((await rows("?range=1y&tz=UTC")).status).toBe(400);
    expect((await rows("?range=30d&tz=Not%2FAZone")).status).toBe(400);
  });
});

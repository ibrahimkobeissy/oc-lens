import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { resetConnectionForTests, type ConnectResult } from "@/lib/db/connection";
import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";
import { resetPricingForTests, writePricing } from "@/lib/pricing/config";
import type { CostBreakdown, CostsRouteResponse, PricingConfig } from "@/types/oc";
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
const dbPath = join(dir, "costs.db");

const pricedConfig: PricingConfig = {
  version: 1,
  prices: {
    "provider/priced": {
      inputPerMTok: 2,
      outputPerMTok: 3,
      cacheReadPerMTok: 4,
      cacheWritePerMTok: 5,
      currency: "USD",
    },
  },
  updatedAt: 1,
};

function assistantData(modelID: string): string {
  return JSON.stringify({
    role: "assistant",
    providerID: "provider",
    modelID,
    tokens: {
      input: 1_000_000,
      output: modelID === "priced" ? 2_000_000 : 0,
      reasoning: 50_000,
      cache: { read: modelID === "priced" ? 500_000 : 0, write: modelID === "priced" ? 250_000 : 0 },
    },
  });
}

function useDb(path: string): void {
  connectionOverride.value = undefined;
  resetConnectionForTests();
  process.env.OC_LENS_DB = path;
}

async function request(query = "?range=all&tz=UTC"): Promise<{ response: Response; body: CostsRouteResponse }> {
  const response = await GET(new Request(`http://localhost/api/costs${query}`));
  return { response, body: await response.json() as CostsRouteResponse };
}

function successfulData(body: CostsRouteResponse): CostBreakdown {
  if (!("data" in body)) throw new Error("Expected successful costs response");
  return body.data;
}

beforeAll(() => {
  process.env.XDG_CONFIG_HOME = configHome;
  createFullSchemaDb(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec("DELETE FROM part; DELETE FROM message;");
  db.prepare("UPDATE session SET cost = ?, time_created = ?, time_updated = ?, agent = ? WHERE id = ?")
    .run(1.25, Date.UTC(2024, 0, 1, 23, 30), Date.UTC(2024, 0, 1, 23, 30), "build", "ses_1");
  db.prepare("INSERT INTO session (id, project_id, slug, directory, title, version, cost, agent, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("ses_2", "global", "second", "/tmp", "Second", "1.17.7", 2.75, null, Date.UTC(2024, 0, 2, 1), Date.UTC(2024, 0, 2, 1));
  const insert = db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)");
  insert.run("msg_priced", "ses_1", Date.UTC(2024, 0, 1, 23, 30), Date.UTC(2024, 0, 1, 23, 30), assistantData("priced"));
  insert.run("msg_unpriced", "ses_2", Date.UTC(2024, 0, 2, 1), Date.UTC(2024, 0, 2, 1), assistantData("unpriced"));
  db.close();
  useDb(dbPath);
});

afterAll(() => {
  resetConnectionForTests();
  if (originalDb === undefined) delete process.env.OC_LENS_DB;
  else process.env.OC_LENS_DB = originalDb;
  if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalConfigHome;
  cleanupTempDir(dir);
});

describe("OCL-091 GET /api/costs", () => {
  it("returns a hand-computed priced cost across every breakdown", async () => {
    writePricing(pricedConfig, { configHome });
    useDb(dbPath);

    const { response, body } = await request();
    const data = successfulData(body);
    expect(response.status).toBe(200);
    // 1M*$2 input + 2M*$3 output + .5M*$4 cache read + .25M*$5 cache write.
    expect(data.totalCost).toEqual({ amount: 0, priced: false });
    expect(data.byModel.find((row) => row.modelID === "priced")).toEqual({
      providerID: "provider",
      modelID: "priced",
      tokens: { input: 1_000_000, output: 2_000_000, reasoning: 50_000, cacheRead: 500_000, cacheWrite: 250_000 },
      cost: { amount: 11.25, priced: true },
    });
    expect(data.byProject).toEqual([{ projectId: "global", cost: { amount: 0, priced: false } }]);
    expect(data.bySession.find((row) => row.sessionId === "ses_1")?.cost).toEqual({ amount: 11.25, priced: true });
    expect(data.byAgent.find((row) => row.agent === "build")).toBeUndefined();
    expect(data.byAgent.find((row) => row.agent === "unknown")?.cost).toEqual({ amount: 0, priced: false });
    expect(data.byDay).toEqual([
      { date: "2024-01-01", cost: { amount: 11.25, priced: true } },
      { date: "2024-01-02", cost: { amount: 0, priced: false } },
    ]);
    expect("meta" in body && body.meta.warnings).toEqual([]);
  });

  it("keeps the provider-reported total separate from computed cost", async () => {
    writePricing(pricedConfig, { configHome });
    useDb(dbPath);
    const data = successfulData((await request()).body);
    expect(data.storedCostComparison).toBe(4);
    expect(data.storedCostComparison).not.toBe(data.totalCost.amount);
  });

  it("returns every model and aggregate as unpriced when no prices exist", async () => {
    resetPricingForTests({ configHome });
    useDb(dbPath);
    const data = successfulData((await request()).body);

    expect(data.byModel.map((row) => row.modelID).sort()).toEqual(["priced", "unpriced"]);
    expect(data.totalCost).toEqual({ amount: 0, priced: false });
    expect(data.byModel.every((row) => row.cost.amount === 0 && !row.cost.priced)).toBe(true);
    expect(data.byProject.every((row) => row.cost.amount === 0 && !row.cost.priced)).toBe(true);
    expect(data.byDay.every((row) => row.cost.amount === 0 && !row.cost.priced)).toBe(true);
    expect(data.bySession.every((row) => row.cost.amount === 0 && !row.cost.priced)).toBe(true);
    expect(data.byAgent.every((row) => row.cost.amount === 0 && !row.cost.priced)).toBe(true);
  });

  it("returns the exact empty CostBreakdown shape", async () => {
    const emptyPath = join(dir, "empty.db");
    createFullSchemaDb(emptyPath);
    const db = new DatabaseSync(emptyPath);
    db.exec("DELETE FROM part; DELETE FROM message; DELETE FROM session; DELETE FROM project;");
    db.close();
    resetPricingForTests({ configHome });
    useDb(emptyPath);

    expect(successfulData((await request()).body)).toEqual({
      totalCost: { amount: 0, priced: false },
      storedCostComparison: 0,
      byModel: [],
      byProject: [],
      byDay: [],
      bySession: [],
      byAgent: [],
    });
  });

  it("validates the established range and timezone query contract", async () => {
    useDb(dbPath);
    expect((await request("?range=year")).response.status).toBe(400);
    expect((await request("?tz=Europe%2FNot_A_Zone")).response.status).toBe(400);
    expect((await request("?range=all&tz=Pacific%2FAuckland")).response.status).toBe(200);
  });

  it("warns when malformed message data is omitted from cost computation", async () => {
    const malformedPath = join(dir, "malformed.db");
    createFullSchemaDb(malformedPath);
    const db = new DatabaseSync(malformedPath);
    db.prepare("UPDATE message SET data = '{' WHERE id = 'msg_1'").run();
    db.close();
    useDb(malformedPath);

    const { body } = await request();

    expect("meta" in body && body.meta.warnings).toContainEqual(
      expect.objectContaining({ code: "malformed-message-data", count: 1 }),
    );
    useDb(dbPath);
  });

  it("returns distinct missing-database and schema-mismatch states", async () => {
    resetConnectionForTests();
    connectionOverride.value = { ok: false, reason: "not-found", searched: [join(dir, "absent.db")] };
    const missing = await request();
    expect(missing.response.status).toBe(404);
    expect("error" in missing.body && missing.body.error.code).toBe("database_not_found");

    const mismatchPath = join(dir, "mismatch.db");
    const mismatchDb = new DatabaseSync(mismatchPath);
    mismatchDb.exec("CREATE TABLE project (id TEXT PRIMARY KEY)");
    mismatchDb.close();
    useDb(mismatchPath);
    const mismatch = await request();
    expect(mismatch.response.status).toBe(409);
    expect("error" in mismatch.body && mismatch.body.error.code).toBe("schema_mismatch");
  });
});

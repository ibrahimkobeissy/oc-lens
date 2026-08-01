import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inclusiveSubagentRollup } from "@/components/sessions/subagent-tree";
import * as connectionModule from "@/lib/db/connection";
import { resetConnectionForTests } from "@/lib/db/connection";
import { cleanupTempDir, makeTempDir } from "@/lib/db/__tests__/test-db";
import { writePricing } from "@/lib/pricing/config";
import { EMPTY_DB_PATH, POPULATED_DB_PATH } from "@/test/fixtures";
import type { PricingConfig, SubagentNode, SubagentTreeRouteResponse } from "@/types/oc";
import { dynamic, GET } from "./route";

const RATE = { inputPerMTok: 1, outputPerMTok: 1, cacheReadPerMTok: 1, cacheWritePerMTok: 1, currency: "USD" as const };
const ALL_PRICES: PricingConfig = {
  version: 1,
  updatedAt: 1,
  prices: {
    "anthropic/claude-haiku-4-5": RATE,
    "openai/gpt-5-mini": RATE,
    "google/gemini-2.5-pro": RATE,
    "opencode/deepseek-v4-flash-free": RATE,
  },
};

async function payload(response: Response): Promise<SubagentTreeRouteResponse> {
  return response.json() as Promise<SubagentTreeRouteResponse>;
}

function request(id: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/sessions/${encodeURIComponent(id)}/tree`), { params: Promise.resolve({ id }) });
}

function descendants(node: SubagentNode): SubagentNode[] {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

describe("GET /api/sessions/[id]/tree", () => {
  let directory: string;
  let databasePath: string;
  let originalDb: string | undefined;
  let originalConfigHome: string | undefined;

  beforeEach(() => {
    directory = makeTempDir();
    databasePath = join(directory, "populated.db");
    copyFileSync(POPULATED_DB_PATH, databasePath);
    originalDb = process.env.OC_LENS_DB;
    originalConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.OC_LENS_DB = databasePath;
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

  it("returns the exact fixture hierarchy with honest D3 costs and ses_0000 roll-up totals", async () => {
    writePricing(ALL_PRICES, { configHome: process.env.XDG_CONFIG_HOME });
    const response = await request("ses_0000");
    const body = await payload(response);

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    if (!("data" in body)) throw new Error("expected subagent tree envelope");
    expect(body.data.children.map((child) => child.sessionId)).toEqual(["ses_0035", "ses_0036", "ses_0038"]);
    expect(body.data.cost).toEqual({ amount: 0, priced: false });
    expect(body.data.children.map((child) => child.cost.priced)).toEqual([true, true, true]);
    const rollup = inclusiveSubagentRollup(body.data);
    expect(rollup.tokens).toEqual({ input: 377_114, output: 60_747, reasoning: 10_172, cacheRead: 130_482, cacheWrite: 20_497 });
    expect(rollup.toolCallCount).toBe(284);
    expect(rollup.cost).toEqual({ amount: 0, priced: false });
  });

  it("keeps a partially priced inclusive tree wholly unpriced", async () => {
    const partial = { ...ALL_PRICES, prices: { ...ALL_PRICES.prices } };
    delete partial.prices["opencode/deepseek-v4-flash-free"];
    writePricing(partial, { configHome: process.env.XDG_CONFIG_HOME });
    const response = await request("ses_0000");
    const body = await payload(response);

    if (!("data" in body)) throw new Error("expected subagent tree envelope");
    expect(body.data.children.find((child) => child.sessionId === "ses_0038")?.cost).toEqual({ amount: 0, priced: false });
    expect(inclusiveSubagentRollup(body.data).cost).toEqual({ amount: 0, priced: false });
  });

  it("surfaces malformed pricing evidence only from sessions in the returned tree", async () => {
    const before = await payload(await request("ses_0000"));
    if (!("data" in before)) throw new Error("expected subagent tree envelope");
    const previousCount = before.meta.warnings.find((warning) => warning.code === "malformed-message-data")?.count ?? 0;
    resetConnectionForTests();
    const db = new DatabaseSync(databasePath);
    db.prepare("UPDATE message SET data = '{' WHERE id = (SELECT id FROM message WHERE session_id = 'ses_0035' LIMIT 1)").run();
    db.prepare("UPDATE message SET data = '{' WHERE id = (SELECT id FROM message WHERE session_id = 'ses_0003' LIMIT 1)").run();
    db.close();
    resetConnectionForTests();

    const body = await payload(await request("ses_0000"));

    if (!("data" in body)) throw new Error("expected subagent tree envelope");
    expect(body.meta.warnings.find((warning) => warning.code === "malformed-message-data")?.count).toBe(previousCount + 1);
  });

  it("terminates cycles and depth-over-ten trees while surfacing stable warnings", async () => {
    const edgePath = join(directory, "edges.db");
    copyFileSync(EMPTY_DB_PATH, edgePath);
    const db = new DatabaseSync(edgePath);
    db.prepare("INSERT INTO project (id, worktree, name, time_created, time_updated) VALUES ('p', '/p', 'p', 1, 1)").run();
    const insert = db.prepare("INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, agent, time_created, time_updated) VALUES (?, 'p', ?, ?, '/p', ?, '1', NULL, 1, 2)");
    insert.run("a", "b", "a", "a");
    insert.run("b", "a", "b", "b");
    for (let index = 0; index < 12; index += 1) {
      const id = `depth-${index}`;
      insert.run(id, index === 0 ? null : `depth-${index - 1}`, id, id);
    }
    db.close();
    process.env.OC_LENS_DB = edgePath;
    resetConnectionForTests();

    const cycle = await payload(await request("a"));
    if (!("data" in cycle)) throw new Error("expected cycle tree envelope");
    expect(cycle.data.children[0]?.sessionId).toBe("b");
    expect(cycle.data.children[0]?.children).toEqual([]);
    expect(cycle.meta.warnings.some((warning) => warning.code === "subagent-cycle")).toBe(true);

    const deep = await payload(await request("depth-0"));
    if (!("data" in deep)) throw new Error("expected deep tree envelope");
    expect(descendants(deep.data)).toHaveLength(10);
    expect(deep.meta.warnings.some((warning) => warning.code === "subagent-depth-limit")).toBe(true);
  });

  it("returns sanitized invalid, unknown, database, and schema states", async () => {
    const invalid = await request("");
    expect(invalid.status).toBe(400);
    expect(await payload(invalid)).toMatchObject({ error: { code: "invalid_session_id" } });

    const unknown = await request("missing-session");
    expect(unknown.status).toBe(404);
    expect(await payload(unknown)).toMatchObject({ error: { code: "session_not_found" } });

    const connection = vi.spyOn(connectionModule, "getConnection");
    connection.mockReturnValueOnce({ ok: false, reason: "not-found", searched: ["/private/missing.db"] });
    const missing = await request("session");
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain("/private/missing.db");

    connection.mockReturnValueOnce({ ok: false, reason: "schema-mismatch", mismatch: { table: "session", missingColumns: ["parent_id"] } });
    const mismatch = await request("session");
    expect(mismatch.status).toBe(409);
    expect(await payload(mismatch)).toMatchObject({ error: { code: "schema_mismatch" } });
  });
});

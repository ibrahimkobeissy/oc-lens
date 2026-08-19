import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as connectionModule from "@/lib/db/connection";
import { resetConnectionForTests } from "@/lib/db/connection";
import { cleanupTempDir, makeTempDir } from "@/lib/db/__tests__/test-db";
import { EMPTY_DB_PATH, POPULATED_DB_PATH } from "@/test/fixtures";
import type { AgentsRouteResponse } from "@/types/oc";
import { dynamic, GET } from "./route";

async function body(response: Response): Promise<AgentsRouteResponse> {
  return response.json() as Promise<AgentsRouteResponse>;
}

describe("GET /api/agents", () => {
  let directory: string;
  let populatedCopy: string;
  let emptyCopy: string;
  let originalDb: string | undefined;
  let originalConfigHome: string | undefined;

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

  it("returns exact fixture aggregates, explicit unknown, activity, and the real switch timeline", async () => {
    const response = await GET();
    const payload = await body(response);

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    if (!("data" in payload)) throw new Error("expected agents envelope");
    const build = payload.data.agents.find((agent) => agent.agent === "build");
    expect(build?.toolMix.find((tool) => tool.tool === "read")?.calls).toBe(125);
    expect(build?.toolMix.reduce((total, tool) => total + tool.calls, 0)).toBe(1_512);
    expect(build?.errorCount).toBe(206);
    expect(payload.data.agents.find((agent) => agent.agent === "unknown")?.sessionCount).toBeGreaterThanOrEqual(10);
    expect(payload.data.agents.every((agent) => agent.cost.priced === false)).toBe(true);
    expect(payload.data.activity.reduce((total, point) => total + point.messageCount, 0)).toBe(4_079);
    expect(payload.data.switches).toHaveLength(126);
    expect(payload.data.switches.map((event) => event.seq)).toEqual(
      [...payload.data.switches.map((event) => event.seq)].sort((left, right) => left - right),
    );
  });

  it("returns the exact empty response", async () => {
    process.env.OC_LENS_DB = emptyCopy;
    resetConnectionForTests();
    const response = await GET();
    const payload = await body(response);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ data: { agents: [], activity: [], switches: [] }, meta: { warnings: [] } });
  });

  it("returns explicit database and schema states", async () => {
    const connection = vi.spyOn(connectionModule, "getConnection");
    connection.mockReturnValueOnce({ ok: false, reason: "not-found", searched: ["/missing/opencode.db"] });
    const missing = await GET();
    expect(missing.status).toBe(404);
    expect(await body(missing)).toMatchObject({ error: { code: "database_not_found" } });

    connection.mockReturnValueOnce({
      ok: false,
      reason: "schema-mismatch",
      mismatch: { table: "session_message", missingColumns: ["data"] },
    });
    const mismatch = await GET();
    expect(mismatch.status).toBe(409);
    expect(await body(mismatch)).toMatchObject({ error: { code: "schema_mismatch" } });
  });
});

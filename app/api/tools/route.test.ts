import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as connectionModule from "@/lib/db/connection";
import { resetConnectionForTests } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { EMPTY_DB_PATH, MINIMUMS, POPULATED_DB_PATH } from "@/test/fixtures";
import type { ToolsRouteResponse } from "@/types/oc";
import { dynamic, GET } from "./route";

async function body(response: Response): Promise<ToolsRouteResponse> {
  return (await response.json()) as ToolsRouteResponse;
}

describe("GET /api/tools", () => {
  let directory: string;
  let originalDb: string | undefined;
  let originalConfigHome: string | undefined;

  beforeEach(() => {
    directory = join(tmpdir(), `oc-lens-tools-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(join(directory, "config", "opencode"), { recursive: true });
    writeFileSync(
      join(directory, "config", "opencode", "opencode.jsonc"),
      JSON.stringify({
        mcp: {
          linear: { type: "local" },
          linear_docs: { type: "remote" },
          serena: { type: "local" },
        },
      }),
    );
    originalDb = process.env.OC_LENS_DB;
    originalConfigHome = process.env.XDG_CONFIG_HOME;
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
    rmSync(directory, { recursive: true, force: true });
  });

  it("matches the populated contract, resolves the longest MCP prefix, and responds within 500ms", async () => {
    const isolatedDb = join(directory, "populated.db");
    copyFileSync(POPULATED_DB_PATH, isolatedDb);
    process.env.OC_LENS_DB = isolatedDb;

    const started = performance.now();
    const response = await GET(new Request("http://localhost/api/tools?range=all"));
    const elapsed = performance.now() - started;
    const result = await body(response);

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(500);
    expect(result).toMatchObject({ meta: { schemaVersion } });
    if ("data" in result) {
      expect(result.data.tools.reduce((total, tool) => total + tool.totalCalls, 0)).toBeGreaterThan(0);
      expect(result.data.errors.length).toBeGreaterThanOrEqual(MINIMUMS.errorToolCalls);
      expect(result.data.skills.length).toBeGreaterThanOrEqual(MINIMUMS.skillNames);
      expect(result.data.versionHistory).toHaveLength(1);
      expect(result.data.featureAdoption.mcp.sessionCount).toBeGreaterThan(0);
      const linearDocs = result.data.mcpServers.find((server) => server.server === "linear_docs");
      expect(linearDocs?.toolCalls).toBeGreaterThan(0);
      expect(linearDocs?.tools).toContainEqual(expect.objectContaining({ tool: "search" }));
      expect(result.data.mcpServers.find((server) => server.server === "linear")?.tools ?? [])
        .not.toContainEqual(expect.objectContaining({ tool: "docs_search" }));
    }
  });

  it("returns the complete clean empty shape", async () => {
    const isolatedDb = join(directory, "empty.db");
    copyFileSync(EMPTY_DB_PATH, isolatedDb);
    process.env.OC_LENS_DB = isolatedDb;

    const response = await GET(new Request("http://localhost/api/tools?range=all"));
    const result = await body(response);

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      data: {
        tools: [],
        errors: [],
        mcpServers: [],
        skills: [],
        versionHistory: [],
      },
      meta: { schemaVersion, warnings: [] },
    });
    if ("data" in result) {
      expect(Object.values(result.data.featureAdoption).every(
        (row) => row.sessionCount === 0 && row.pct === 0 && row.firstUsed === null,
      )).toBe(true);
    }
  });

  it("rejects invalid ranges before opening the database", async () => {
    const connection = vi.spyOn(connectionModule, "getConnection");

    const response = await GET(new Request("http://localhost/api/tools?range=year"));

    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({
      error: { code: "invalid_range", message: "Range must be one of 7d, 30d, 90d, or all." },
    });
    expect(connection).not.toHaveBeenCalled();
  });

  it("returns honest database and schema states without exposing locator details", async () => {
    vi.spyOn(connectionModule, "getConnection").mockReturnValueOnce({
      ok: false,
      reason: "not-found",
      searched: ["/private/location/opencode.db"],
    }).mockReturnValueOnce({
      ok: false,
      reason: "schema-mismatch",
      mismatch: { table: "part", missingColumns: ["data"] },
    });

    const missing = await GET(new Request("http://localhost/api/tools"));
    const mismatch = await GET(new Request("http://localhost/api/tools"));

    expect(missing.status).toBe(404);
    expect(JSON.stringify(await body(missing))).not.toContain("/private/location");
    expect(mismatch.status).toBe(409);
    expect(await body(mismatch)).toEqual({
      error: { code: "schema_mismatch", message: `The opencode database schema is not supported by ${schemaVersion}.` },
    });
  });
});

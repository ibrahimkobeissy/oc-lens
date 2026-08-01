import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { decodePartData } from "@/lib/decode";
import { MCP_SERVERS, withEmptyFixture, withFixture } from "@/test/fixtures";
import { FIXTURE_SCHEMA_SQL } from "@/test/fixtures/schema";
import { featureAdoption, mcpUsage, skillUsage, toolErrors, toolUsage } from "../tools";

const servers = Object.values(MCP_SERVERS).map((entry) => entry.server);

describe("OCL-015 tool queries", () => {
  it("computes status buckets and duration percentiles from state.time only", () => withFixture((db) => {
    const result = toolUsage(db).data;
    expect(result.reduce((n, row) => n + row.pendingCount, 0)).toBeGreaterThanOrEqual(1);
    expect(result.reduce((n, row) => n + row.runningCount, 0)).toBeGreaterThanOrEqual(1);
    const rows = db.prepare("SELECT data FROM part").all() as Array<{ data: string }>;
    const calls = rows.map((r) => decodePartData(r.data).value).filter((p) => p.type === "tool");
    expect(result.reduce((n, row) => n + row.totalCalls, 0)).toBe(calls.length);
    for (const summary of result) {
      const durations = calls.filter((c) => c.tool === summary.tool && c.timeStart !== null && c.timeEnd !== null).map((c) => c.timeEnd! - c.timeStart!).sort((a, b) => a - b);
      expect(summary.p50DurationMs).toBe(durations[Math.ceil(durations.length * 0.5) - 1] ?? null);
      expect(summary.p95DurationMs).toBe(durations[Math.ceil(durations.length * 0.95) - 1] ?? null);
    }
    const pendingTool = calls.find((c) => c.status === "pending");
    expect(pendingTool?.timeStart === null || pendingTool?.timeEnd === null).toBe(true);
    expect(result.find((r) => r.tool === pendingTool?.tool)?.p50DurationMs).not.toBe(0);
  }));

  it("groups underscore-containing MCP servers by longest configured prefix", () => withFixture((db) => {
    const result = mcpUsage(db, servers).data;
    const linear = result.find((row) => row.server === "linear_docs");
    expect(linear?.toolCalls).toBeGreaterThan(0);
    expect(linear?.tools.some((tool) => tool.tool === "search")).toBe(true);
    expect("linear_docs_search".split("_")[0]).toBe("linear");
    expect(linear?.server).not.toBe("linear");
    expect(mcpUsage(db, []).data).toEqual([]);
  }));

  it("extracts fixture skill names and categorises tool errors", () => withFixture((db) => {
    const skills = skillUsage(db).data;
    expect(skills.length).toBeGreaterThanOrEqual(5);
    expect(skills.every((skill) => skill.totalCalls > 0 && skill.sessionCount > 0)).toBe(true);
    const errors = toolErrors(db).data;
    expect(errors.length).toBeGreaterThanOrEqual(40);
    expect(errors.every((error) => error.message.length > 0 && error.category.length > 0)).toBe(true);
  }));

  it("uses state.error and preserves the exact signed timestamp delta", () => {
    const db = new DatabaseSync(":memory:"); db.exec(FIXTURE_SCHEMA_SQL);
    db.prepare("INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('s', 'global', 's', '/', 's', '1', 1, 2)").run();
    db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('p', 'm', 's', 1, 1, ?)").run(JSON.stringify({ type: "tool", tool: "read", callID: "c", state: { status: "error", input: {}, error: "Permission denied", time: { start: 20, end: 10 } } }));
    expect(toolErrors(db).data[0]).toMatchObject({ message: "Permission denied", category: "permission-denied" });
    expect(toolUsage(db).data[0]).toMatchObject({ p50DurationMs: -10, p95DurationMs: -10 }); db.close();
  });

  it("reports feature adoption as finite fractions", () => withFixture((db) => {
    const result = featureAdoption(db, servers).data;
    for (const row of Object.values(result)) {
      expect(Number.isFinite(row.pct)).toBe(true);
      expect(row.pct).toBeGreaterThanOrEqual(0);
      expect(row.pct).toBeLessThanOrEqual(1);
    }
    expect(result.subagents.sessionCount).toBeGreaterThan(0);
    expect(result.mcp.sessionCount).toBeGreaterThan(0);
    expect(result.reasoning.sessionCount).toBeGreaterThan(0);
    expect(result.todos.sessionCount).toBeGreaterThan(0);
  }));

  it("returns clean zero/empty values on the empty fixture", () => withEmptyFixture((db) => {
    expect(toolUsage(db)).toEqual({ data: [], warnings: [] });
    expect(toolErrors(db)).toEqual({ data: [], warnings: [] });
    expect(mcpUsage(db, servers)).toEqual({ data: [], warnings: [] });
    expect(skillUsage(db)).toEqual({ data: [], warnings: [] });
    const adoption = featureAdoption(db, servers).data;
    expect(Object.values(adoption).every((row) => row.sessionCount === 0 && row.pct === 0 && row.firstUsed === null)).toBe(true);
  }));
});

import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { withEmptyFixture, withFixture } from "@/test/fixtures";
import { FIXTURE_SCHEMA_SQL } from "@/test/fixtures/schema";
import { agentSwitchEvents, agentUsage } from "../agents";

describe("OCL-015 agent queries", () => {
  it("keeps unknown agents explicit and aggregates messages, tokens and tool mix", () => withFixture((db) => {
    const result = agentUsage(db).data;
    expect(result.find((row) => row.agent === "unknown")?.sessionCount).toBeGreaterThanOrEqual(10);
    // A session can legitimately count for multiple agents after a switch.
    expect(result.reduce((n, row) => n + row.sessionCount, 0)).toBeGreaterThanOrEqual(120);
    expect(result.reduce((n, row) => n + row.messageCount, 0)).toBe((db.prepare("SELECT COUNT(*) AS n FROM message").get() as { n: number }).n);
    expect(result.some((row) => row.toolMix.length > 0)).toBe(true);
    expect(result.every((row) => row.cost.priced === false)).toBe(true);
  }));

  it("decodes ordered agent switch events", () => withFixture((db) => {
    const switches = agentSwitchEvents(db).data;
    expect(switches).toHaveLength(120);
    expect(switches.every((event) => event.sessionId !== null && event.timeCreated !== null)).toBe(true);
    expect(switches.map((event) => event.seq)).toEqual([...switches.map((event) => event.seq)].sort((a, b) => a - b));
  }));

  it("counts a session for an agent observed in its messages after a switch", () => {
    const db = new DatabaseSync(":memory:"); db.exec(FIXTURE_SCHEMA_SQL);
    db.prepare("INSERT INTO session (id, project_id, slug, directory, title, version, agent, time_created, time_updated) VALUES ('s', 'global', 's', '/', 's', '1', 'build', 1, 11)").run();
    db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('m', 's', 2, 3, ?)").run(JSON.stringify({ role: "assistant", agent: "review", time: { created: 2, completed: 3 } }));
    const review = agentUsage(db).data.find((row) => row.agent === "review");
    expect(review).toMatchObject({ sessionCount: 1, messageCount: 1, avgSessionLengthMs: 10 }); db.close();
  });

  it("returns cleanly on the empty fixture", () => withEmptyFixture((db) => {
    expect(agentUsage(db)).toEqual({ data: [], warnings: [] });
    expect(agentSwitchEvents(db)).toEqual({ data: [], warnings: [] });
  }));
});

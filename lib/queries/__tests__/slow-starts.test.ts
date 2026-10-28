import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";

import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";
import { ensureCanonicalViews } from "@/lib/db/canonical";
import { openReadOnly } from "@/lib/db/connection";
import { slowStartReport } from "@/lib/queries/slow-starts";
import { buildV2Fixture, V2_MODEL, V2_T0 } from "@/test/fixtures/v2-fixture";

const dir = makeTempDir();
afterAll(() => cleanupTempDir(dir));

const OTHER_MODEL = { id: "m-small", providerID: "acme", variant: "default" };

/** Waits in seconds per step; each step starts a minute after the last. */
function db(waits: Array<[number, typeof V2_MODEL | typeof OTHER_MODEL]>): string {
  const path = join(dir, `slow-${waits.length}-${Math.random().toString(36).slice(2)}.db`);
  buildV2Fixture(path);
  const conn = new DatabaseSync(path);
  conn.prepare(`INSERT INTO session_v2 (id, project_id, slug, directory, title, version, agent, model, time_created, time_updated)
    VALUES ('ses_slow', 'prj_alpha', 'slow', '/w/alpha', 'Slow day', '2.2.0', 'build', ?, ?, ?)`).run(JSON.stringify(V2_MODEL), V2_T0, V2_T0);
  const insert = conn.prepare("INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, 'ses_slow', 'assistant', ?, ?, ?, ?)");
  waits.forEach(([wait, model], index) => {
    const created = V2_T0 + 1_000_000 + index * 60_000;
    insert.run(`msg_s${String(index).padStart(3, "0")}`, index, created, created, JSON.stringify({ agent: "build", model, content: [], tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created, streamed: created + wait * 1000, completed: created + wait * 1000 + 500 } }));
  });
  conn.close();
  return path;
}

function report(path: string, sessionId?: string) {
  const conn = openReadOnly(path);
  try { ensureCanonicalViews(conn); return slowStartReport(conn, "UTC", {}, sessionId); } finally { conn.close(); }
}

describe("slowStartReport", () => {
  it("flags a wait far above its model's usual, and only that", () => {
    // Usual wait 5 s: 40 s is 8× and over 30 s; 25 s is 5× but under the 30 s floor.
    const path = db([[5, V2_MODEL], [5, V2_MODEL], [5, V2_MODEL], [4, V2_MODEL], [6, V2_MODEL], [40, V2_MODEL], [25, V2_MODEL]]);
    const result = report(path, "ses_slow");
    expect(result.measurable).toBe(true);
    expect(result.slowSteps.map((step) => [step.messageId, step.waitSeconds, step.baselineSeconds])).toEqual([["msg_s005", 40, 5]]);
    expect(result.slowSteps[0]).toMatchObject({ sessionTitle: "Slow day", model: "acme/m-large" });
    expect(result.byDay).toEqual([expect.objectContaining({ steps: 7, medianSeconds: 5, slowSteps: 1 })]);
  });

  it("judges each model against its own usual wait", () => {
    // m-small usually takes 50 s, so 60 s is not slow for it; 60 s on m-large (usual 5 s) is.
    const path = db([[5, V2_MODEL], [5, V2_MODEL], [5, V2_MODEL], [50, OTHER_MODEL], [50, OTHER_MODEL], [50, OTHER_MODEL], [60, OTHER_MODEL], [60, V2_MODEL]]);
    expect(report(path, "ses_slow").slowSteps.map((step) => step.model)).toEqual(["acme/m-large"]);
  });

  it("says it cannot measure a database without first-token times instead of reporting no slow starts", () => {
    const path = join(dir, "v1.db");
    createFullSchemaDb(path);
    const conn = openReadOnly(path);
    try { expect(slowStartReport(conn)).toEqual({ measurable: false, byDay: [], slowSteps: [] }); } finally { conn.close(); }
  });
});

import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetConnectionForTests } from "@/lib/db/connection";
import { cleanupTempDir, makeTempDir } from "@/lib/db/__tests__/test-db";
import { buildMixedFixture, buildV2Fixture, MIGRATED_SESSION, V2_MAIN_SESSION, V2_PROJECT_ID } from "@/test/fixtures/v2-fixture";
import { GET as activity } from "./activity/route";
import { GET as agents } from "./agents/route";
import { GET as costs } from "./costs/route";
import { GET as diagnostics } from "./diagnostics/loops/route";
import { GET as exportRoute } from "./export/route";
import { GET as loops } from "./loops/route";
import { GET as project } from "./projects/[id]/route";
import { GET as projects } from "./projects/route";
import { GET as search } from "./search/route";
import { GET as sessionFiles } from "./sessions/[id]/files/route";
import { GET as replay } from "./sessions/[id]/replay/route";
import { GET as session } from "./sessions/[id]/route";
import { GET as sessionTree } from "./sessions/[id]/tree/route";
import { GET as sessions } from "./sessions/route";
import { GET as sessionsTree } from "./sessions/tree/route";
import { GET as settings } from "./settings/route";
import { GET as skills } from "./skills/route";
import { GET as stats } from "./stats/route";
import { GET as todos } from "./todos/route";
import { GET as tools } from "./tools/route";
import { GET as warningSample } from "./warnings/sample/route";

/**
 * Every API route against a generated opencode 2.x database and a mixed 1.x/2.x
 * one — the routes with their own SQL (export, search, session trees, warnings)
 * as much as the query modules. "200 with data" is the bar here; exact numbers
 * are asserted in lib/db/__tests__/v2-compat.test.ts.
 */

const dir = makeTempDir();
const originalDb = process.env.OC_LENS_DB;
const originalConfigHome = process.env.XDG_CONFIG_HOME;
const paths = { v2: join(dir, "v2.db"), mixed: join(dir, "mixed.db") };

function useDb(path: string): void {
  resetConnectionForTests();
  process.env.OC_LENS_DB = path;
}

const url = (path: string) => new Request(`http://localhost${path}`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(() => {
  process.env.XDG_CONFIG_HOME = join(dir, "config");
  buildV2Fixture(paths.v2);
  buildMixedFixture(paths.mixed);
});

afterAll(() => {
  resetConnectionForTests();
  if (originalDb === undefined) delete process.env.OC_LENS_DB;
  else process.env.OC_LENS_DB = originalDb;
  if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalConfigHome;
  cleanupTempDir(dir);
});

describe.each([
  ["v2", paths.v2, V2_MAIN_SESSION],
  ["mixed", paths.mixed, MIGRATED_SESSION],
] as const)("API routes on a %s database", (generation, path, sessionId) => {
  const routes: Array<[string, () => Promise<Response>]> = [
    ["activity", () => activity(url("/api/activity"))],
    ["agents", () => agents()],
    ["costs", () => costs(url("/api/costs"))],
    ["diagnostics/loops", () => diagnostics(url("/api/diagnostics/loops"))],
    ["export", () => exportRoute(url("/api/export?scope=sessions,replay,todos"))],
    ["export preview", () => exportRoute(url("/api/export?preview=1&scope=sessions,replay,todos"))],
    ["loops", () => loops(url("/api/loops"))],
    ["projects", () => projects()],
    ["projects/[id]", () => project(url(`/api/projects/${V2_PROJECT_ID}`), ctx(V2_PROJECT_ID))],
    ["search", () => search(url("/api/search?q=build"))],
    ["sessions", () => sessions(url("/api/sessions"))],
    ["sessions/[id]", () => session(url(`/api/sessions/${sessionId}`), ctx(sessionId))],
    ["sessions/[id]/files", () => sessionFiles(url(`/api/sessions/${sessionId}/files`), ctx(sessionId))],
    ["sessions/[id]/replay", () => replay(url(`/api/sessions/${sessionId}/replay`), ctx(sessionId))],
    ["sessions/[id]/tree", () => sessionTree(url(`/api/sessions/${sessionId}/tree`), ctx(sessionId))],
    ["sessions/tree", () => sessionsTree()],
    ["settings", () => settings()],
    ["skills", () => skills(url("/api/skills"))],
    ["stats", () => stats(url("/api/stats"))],
    ["todos", () => todos(url("/api/todos"))],
    ["tools", () => tools(url("/api/tools"))],
    ["warnings/sample", () => warningSample(url("/api/warnings/sample?code=unknown-session-event"))],
  ];

  it.each(routes)("%s answers 200 with data", async (_name, call) => {
    useDb(path);
    const response = await call();
    const body = JSON.parse(await response.text()) as { data?: unknown; error?: unknown };
    expect(body.error).toBeUndefined();
    expect(response.status).toBe(200);
    expect(body.data).toBeDefined();
  });

  it("identifies the database generation in settings", async () => {
    useDb(path);
    const body = await (await settings()).json() as { data: { dbGeneration: string; opencodeVersion: string } };
    expect(body.data.dbGeneration).toBe(generation);
    // The newest session's version, not the most common one.
    expect(body.data.opencodeVersion).toBe("2.1.4");
  });

  it("exports replay turns, lifecycle events included, exactly as the replay route serves them", async () => {
    useDb(path);
    type Turn = { messageId: string; role: string; parts: unknown[] };
    const exported = await (await exportRoute(url("/api/export?scope=replay"))).json() as {
      data: { counts: { messages: number; parts: number; events: number }; replays: Array<{ session: { id: string }; turns: Turn[] }> };
    };
    const { counts, replays } = exported.data;
    expect(replays.reduce((sum, r) => sum + r.turns.length, 0)).toBe(counts.messages + counts.events);
    expect(replays.reduce((sum, r) => sum + r.turns.reduce((n, t) => n + t.parts.length, 0), 0)).toBe(counts.parts);
    expect(counts.events).toBeGreaterThan(0);
    const served = await (await replay(url(`/api/sessions/${V2_MAIN_SESSION}/replay`), ctx(V2_MAIN_SESSION))).json() as { data: { turns: Turn[] } };
    const streamed = replays.find((r) => r.session.id === V2_MAIN_SESSION)!;
    expect(streamed.turns.map((t) => [t.messageId, t.role])).toEqual(served.data.turns.map((t) => [t.messageId, t.role]));
  });

  it("exports the replay turns of the session it lists, never an empty or duplicated history", async () => {
    useDb(path);
    const body = await (await exportRoute(url("/api/export?scope=sessions,replay"))).json() as { data: { sessions: Array<{ id: string }> } };
    const ids = body.data.sessions.map((s) => s.id);
    expect(ids).toContain(sessionId);
    expect(ids).toHaveLength(new Set(ids).size);
  });
});

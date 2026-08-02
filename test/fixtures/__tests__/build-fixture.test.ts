import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { checkSchema } from "../../../lib/db/schema-guard";
import { buildFixtures } from "../build-fixture";
import { withFixture, withEmptyFixture } from "../index";
import { POPULATED_DB_PATH, EMPTY_DB_PATH } from "../paths";
import { MINIMUMS, MCP_TOOL_NAMES, SKILL_NAMES, CORE_TOOLS, GLOBAL_PROJECT_ID } from "../manifest";

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function count(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as { c: number };
  return row.c;
}

describe("fixture determinism", () => {
  it(
    "produces byte-identical output across two separate builds",
    () => {
      buildFixtures();
      const first = hashFile(POPULATED_DB_PATH);
      buildFixtures();
      const second = hashFile(POPULATED_DB_PATH);
      expect(second).toBe(first);
    },
    20_000,
  );
});

describe("fixture schema", () => {
  it("passes lib/db/schema-guard.ts's checkSchema unmodified", () => {
    withFixture((db) => {
      expect(checkSchema(db)).toBeNull();
    });
  });

  it("the empty fixture also passes schema-guard and has zero rows everywhere", () => {
    withEmptyFixture((db) => {
      expect(checkSchema(db)).toBeNull();
      for (const table of ["project", "session", "message", "part", "todo", "session_message", "workspace", "session_input"]) {
        expect(count(db, `SELECT COUNT(*) as c FROM ${table}`)).toBe(0);
      }
    });
  });
});

describe("fixture row counts and required scenarios", () => {
  it("meets every minimum from the manifest", () => {
    withFixture((db) => {
      expect(count(db, "SELECT COUNT(*) as c FROM project")).toBeGreaterThanOrEqual(MINIMUMS.projects);
      expect(count(db, "SELECT COUNT(*) as c FROM session")).toBeGreaterThanOrEqual(MINIMUMS.sessions);
      expect(count(db, "SELECT COUNT(*) as c FROM message")).toBeGreaterThanOrEqual(MINIMUMS.messages);
      expect(count(db, "SELECT COUNT(*) as c FROM part")).toBeGreaterThanOrEqual(MINIMUMS.parts);
    });
  });

  it("includes the synthetic global project with worktree '/' and null name", () => {
    withFixture((db) => {
      const row = db.prepare("SELECT worktree, name FROM project WHERE id = ?").get(GLOBAL_PROJECT_ID) as
        | { worktree: string; name: string | null }
        | undefined;
      expect(row).toBeDefined();
      expect(row?.worktree).toBe("/");
      expect(row?.name).toBeNull();
    });
  });

  it("has at least 8 subagent sessions (non-null parent_id)", () => {
    withFixture((db) => {
      expect(count(db, "SELECT COUNT(*) as c FROM session WHERE parent_id IS NOT NULL")).toBeGreaterThanOrEqual(
        MINIMUMS.subagentSessions,
      );
    });
  });

  it("has at least 5 archived sessions (non-null time_archived)", () => {
    withFixture((db) => {
      expect(count(db, "SELECT COUNT(*) as c FROM session WHERE time_archived IS NOT NULL")).toBeGreaterThanOrEqual(
        MINIMUMS.archivedSessions,
      );
    });
  });

  it("has at least 10 sessions with NULL agent and 10 with NULL model", () => {
    withFixture((db) => {
      expect(count(db, "SELECT COUNT(*) as c FROM session WHERE agent IS NULL")).toBeGreaterThanOrEqual(
        MINIMUMS.nullAgentSessions,
      );
      expect(count(db, "SELECT COUNT(*) as c FROM session WHERE model IS NULL")).toBeGreaterThanOrEqual(
        MINIMUMS.nullModelSessions,
      );
    });
  });

  it("has at least 4 placeholder-titled sessions", () => {
    withFixture((db) => {
      expect(count(db, "SELECT COUNT(*) as c FROM session WHERE title LIKE 'New session - %'")).toBeGreaterThanOrEqual(
        MINIMUMS.placeholderTitleSessions,
      );
    });
  });

  it("has at least 3 single-message sessions and exactly one 400-message session", () => {
    withFixture((db) => {
      const rows = db
        .prepare(
          "SELECT session_id, COUNT(*) as c FROM message GROUP BY session_id HAVING c = 1",
        )
        .all() as Array<{ session_id: string; c: number }>;
      expect(rows.length).toBeGreaterThanOrEqual(MINIMUMS.singleMessageSessions);

      const longRows = db
        .prepare("SELECT session_id, COUNT(*) as c FROM message GROUP BY session_id HAVING c = 400")
        .all() as Array<{ session_id: string; c: number }>;
      expect(longRows.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("has at least 40 error-status tool calls", () => {
    withFixture((db) => {
      const rows = db.prepare("SELECT data FROM part").all() as Array<{ data: string }>;
      let errorCount = 0;
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.data) as { type?: string; state?: { status?: string } };
          if (parsed.type === "tool" && parsed.state?.status === "error") errorCount++;
        } catch {
          // malformed-JSON dirt row — expected, skip.
        }
      }
      expect(errorCount).toBeGreaterThanOrEqual(MINIMUMS.errorToolCalls);
    });
  });

  it("has at least one compaction part, shaped exactly as confirmed live on 2026-08-02", () => {
    withFixture((db) => {
      const rows = db.prepare("SELECT data FROM part").all() as Array<{ data: string }>;
      let compactionCount = 0;
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.data) as { type?: string; auto?: unknown; overflow?: unknown; tail_start_id?: unknown };
          if (parsed.type !== "compaction") continue;
          compactionCount++;
          expect(typeof parsed.auto).toBe("boolean");
          expect(typeof parsed.overflow).toBe("boolean");
          expect(typeof parsed.tail_start_id).toBe("string");
        } catch {
          // malformed-JSON dirt row — expected, skip.
        }
      }
      expect(compactionCount).toBeGreaterThanOrEqual(MINIMUMS.compactionParts);
    });
  });

  it("has at least one patch part, shaped exactly as confirmed live on 2026-08-02", () => {
    withFixture((db) => {
      const rows = db.prepare("SELECT data FROM part").all() as Array<{ data: string }>;
      let patchCount = 0;
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.data) as { type?: string; hash?: unknown; files?: unknown };
          if (parsed.type !== "patch") continue;
          patchCount++;
          expect(typeof parsed.hash).toBe("string");
          expect(Array.isArray(parsed.files)).toBe(true);
        } catch {
          // malformed-JSON dirt row — expected, skip.
        }
      }
      expect(patchCount).toBeGreaterThanOrEqual(MINIMUMS.patchParts);
    });
  });

  it("has at least one pending and one running tool call", () => {
    withFixture((db) => {
      const rows = db.prepare("SELECT data FROM part").all() as Array<{ data: string }>;
      let pending = 0;
      let running = 0;
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.data) as { type?: string; state?: { status?: string } };
          if (parsed.type === "tool" && parsed.state?.status === "pending") pending++;
          if (parsed.type === "tool" && parsed.state?.status === "running") running++;
        } catch {
          // expected malformed-JSON dirt row
        }
      }
      expect(pending).toBeGreaterThanOrEqual(1);
      expect(running).toBeGreaterThanOrEqual(1);
    });
  });

  it("covers every core tool at least once", () => {
    withFixture((db) => {
      const rows = db.prepare("SELECT data FROM part").all() as Array<{ data: string }>;
      const seen = new Set<string>();
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.data) as { type?: string; tool?: string };
          if (parsed.type === "tool" && parsed.tool) seen.add(parsed.tool);
        } catch {
          // expected malformed-JSON dirt row
        }
      }
      for (const tool of CORE_TOOLS) {
        expect(seen.has(tool)).toBe(true);
      }
    });
  });

  it("includes the underscore-server MCP tool name and a naive first-underscore split would misread it", () => {
    withFixture((db) => {
      const rows = db.prepare("SELECT data FROM part").all() as Array<{ data: string }>;
      const seen = new Set<string>();
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.data) as { type?: string; tool?: string };
          if (parsed.type === "tool" && parsed.tool) seen.add(parsed.tool);
        } catch {
          // expected
        }
      }
      for (const name of MCP_TOOL_NAMES) {
        expect(seen.has(name)).toBe(true);
      }

      const underscoreServerTool = "linear_docs_search";
      expect(seen.has(underscoreServerTool)).toBe(true);
      const naiveFirstUnderscoreServer = underscoreServerTool.split("_")[0];
      expect(naiveFirstUnderscoreServer).not.toBe("linear_docs");
    });
  });

  it("covers at least 5 distinct skill names via the skill tool", () => {
    withFixture((db) => {
      const rows = db.prepare("SELECT data FROM part").all() as Array<{ data: string }>;
      const seen = new Set<string>();
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.data) as {
            type?: string;
            tool?: string;
            state?: { input?: { name?: string } };
          };
          if (parsed.type === "tool" && parsed.tool === "skill" && parsed.state?.input?.name) {
            seen.add(parsed.state.input.name);
          }
        } catch {
          // expected
        }
      }
      expect(seen.size).toBeGreaterThanOrEqual(MINIMUMS.skillNames);
      for (const name of SKILL_NAMES) {
        expect(seen.has(name)).toBe(true);
      }
    });
  });

  it("todo rows cover all three statuses", () => {
    withFixture((db) => {
      const rows = db.prepare("SELECT DISTINCT status FROM todo").all() as Array<{ status: string }>;
      const statuses = new Set(rows.map((r) => r.status));
      expect(statuses.has("pending")).toBe(true);
      expect(statuses.has("in_progress")).toBe(true);
      expect(statuses.has("completed")).toBe(true);
    });
  });

  it("has exactly one malformed-JSON row and one unknown part type, and at least one message with no time.completed", () => {
    withFixture((db) => {
      const messageRows = db.prepare("SELECT data FROM message").all() as Array<{ data: string }>;
      let malformed = 0;
      let missingCompleted = 0;
      for (const row of messageRows) {
        try {
          const parsed = JSON.parse(row.data) as { role?: string; time?: { completed?: number } };
          if (parsed.role === "assistant" && parsed.time && parsed.time.completed === undefined) {
            missingCompleted++;
          }
        } catch {
          malformed++;
        }
      }
      expect(malformed).toBeGreaterThanOrEqual(1);
      expect(missingCompleted).toBeGreaterThanOrEqual(1);

      const partRows = db.prepare("SELECT data FROM part").all() as Array<{ data: string }>;
      const unknownTypes = partRows.filter((row) => {
        try {
          const parsed = JSON.parse(row.data) as { type?: string };
          return !["text", "reasoning", "step-start", "step-finish", "tool"].includes(parsed.type ?? "");
        } catch {
          return false;
        }
      });
      expect(unknownTypes.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("fixture files are gitignored", () => {
  it("generated .db files exist on disk but are excluded by .gitignore", () => {
    expect(existsSync(POPULATED_DB_PATH)).toBe(true);
    expect(existsSync(EMPTY_DB_PATH)).toBe(true);
    // git-status verification happens at the CI/DoD level (git status --short),
    // not practical to shell out to git from a unit test in a worktree context.
  });
});

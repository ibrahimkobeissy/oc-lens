import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as connectionModule from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { FIXTURE_SCHEMA_SQL } from "@/test/fixtures/schema";
import type { TodosRouteResponse } from "@/types/oc";
import { dynamic, GET } from "./route";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(FIXTURE_SCHEMA_SQL);
  return db;
}

function addSession(db: DatabaseSync, id: string, projectId: string): void {
  db.prepare(
    "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (?, ?, ?, '/', ?, '1', 1, 1)",
  ).run(id, projectId, id, id);
}

function addTodo(db: DatabaseSync, sessionId: string, content: string, status: string, position: number): void {
  db.prepare(
    "INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated) VALUES (?, ?, ?, 'high', ?, ?, ?)",
  ).run(sessionId, content, status, position, position + 10, position + 10);
}

async function body(response: Response): Promise<TodosRouteResponse> {
  return (await response.json()) as TodosRouteResponse;
}

afterEach(() => vi.restoreAllMocks());

describe("GET /api/todos", () => {
  it("returns todos grouped by session in position order with honest rollups", async () => {
    const db = database();
    addSession(db, "session-a", "project-a");
    addSession(db, "session-b", "project-b");
    addTodo(db, "session-a", "second", "completed", 2);
    addTodo(db, "session-a", "first", "pending", 0);
    addTodo(db, "session-b", "mystery", "blocked", 1);
    vi.spyOn(connectionModule, "getConnection").mockReturnValue({ ok: true, db });

    const response = await GET(new Request("http://localhost/api/todos"));
    const result = await body(response);

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      data: {
        sessions: [
          { sessionId: "session-a", projectId: "project-a", rollup: { pending: 1, inProgress: 0, completed: 1, unknown: 0 } },
          { sessionId: "session-b", projectId: "project-b", rollup: { pending: 0, inProgress: 0, completed: 0, unknown: 1 } },
        ],
        rollup: { pending: 1, inProgress: 0, completed: 1, unknown: 1 },
      },
      meta: { schemaVersion, warnings: [{ code: "unknown-todo-status", count: 1 }] },
    });
    if ("data" in result) {
      expect(result.data.sessions[0]?.todos.map((todo) => [todo.content, todo.status, todo.position])).toEqual([
        ["first", "pending", 0],
        ["second", "completed", 2],
      ]);
      expect(result.data.sessions[1]?.todos[0]?.status).toBe("unknown");
    }
    db.close();
  });

  it("filters by project and decoded status", async () => {
    const db = database();
    addSession(db, "session-a", "project-a");
    addSession(db, "session-b", "project-b");
    addTodo(db, "session-a", "keep", "in_progress", 0);
    addTodo(db, "session-a", "drop-status", "pending", 1);
    addTodo(db, "session-b", "drop-project", "in_progress", 0);
    vi.spyOn(connectionModule, "getConnection").mockReturnValue({ ok: true, db });

    const result = await body(await GET(new Request("http://localhost/api/todos?project=project-a&status=in_progress")));

    expect("data" in result && result.data.sessions).toHaveLength(1);
    expect("data" in result && result.data.sessions[0]?.todos.map((todo) => todo.content)).toEqual(["keep"]);
    expect("data" in result && result.data.rollup).toEqual({ pending: 0, inProgress: 1, completed: 0, unknown: 0 });
    db.close();
  });

  it("returns the exact empty shape", async () => {
    const db = database();
    vi.spyOn(connectionModule, "getConnection").mockReturnValue({ ok: true, db });

    const result = await body(await GET(new Request("http://localhost/api/todos")));

    expect(result).toMatchObject({
      data: { sessions: [], rollup: { pending: 0, inProgress: 0, completed: 0, unknown: 0 } },
      meta: { schemaVersion, warnings: [] },
    });
    db.close();
  });

  it("rejects invalid filters before opening the database", async () => {
    const connection = vi.spyOn(connectionModule, "getConnection");
    const response = await GET(new Request("http://localhost/api/todos?status=done"));
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({ error: { code: "invalid_status", message: "status must be pending, in_progress, completed, or unknown" } });
    expect(connection).not.toHaveBeenCalled();
  });

  it("returns explicit database and schema states", async () => {
    vi.spyOn(connectionModule, "getConnection")
      .mockReturnValueOnce({ ok: false, reason: "not-found", searched: ["/not/exposed"] })
      .mockReturnValueOnce({ ok: false, reason: "schema-mismatch", mismatch: { table: "todo", missingColumns: ["status"] } });

    const missing = await GET(new Request("http://localhost/api/todos"));
    const mismatch = await GET(new Request("http://localhost/api/todos"));

    expect(missing.status).toBe(404);
    expect(mismatch.status).toBe(409);
    expect(await body(missing)).toEqual({ error: { code: "database_not_found", message: "No opencode database was found." } });
    expect(await body(mismatch)).toEqual({ error: { code: "schema_mismatch", message: `Database schema does not match ${schemaVersion}.` } });
  });

  it("returns the typed error envelope when database access throws", async () => {
    vi.spyOn(connectionModule, "getConnection").mockImplementation(() => { throw new Error("private detail"); });
    const response = await GET(new Request("http://localhost/api/todos"));
    expect(response.status).toBe(500);
    expect(await body(response)).toEqual({
      error: { code: "todos_failed", message: "Todos could not be read from the opencode database." },
    });
  });
});

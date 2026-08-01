import type { DatabaseSync } from "node:sqlite";

import { query } from "@/lib/db/connection";
import type { OcTodo, OcWarning, SessionTodos, TodoRollup, TodosResponse, TodoStatus } from "@/types/oc";

interface TodoRow {
  session_id: string;
  project_id: string;
  content: string;
  status: string;
  priority: string | null;
  position: number;
  time_created: number;
  time_updated: number;
}

export interface TodoFilters {
  projectId?: string;
  status?: TodoStatus;
}

function decodeStatus(value: string): TodoStatus {
  return value === "pending" || value === "in_progress" || value === "completed" ? value : "unknown";
}

function emptyRollup(): TodoRollup {
  return { pending: 0, inProgress: 0, completed: 0, unknown: 0 };
}

function add(rollup: TodoRollup, value: TodoStatus): void {
  if (value === "pending") rollup.pending += 1;
  else if (value === "in_progress") rollup.inProgress += 1;
  else if (value === "completed") rollup.completed += 1;
  else rollup.unknown += 1;
}

export function readTodos(
  db: DatabaseSync,
  filters: TodoFilters = {},
): { data: TodosResponse; warnings: OcWarning[] } {
  const rows = query<TodoRow>(
    db,
    `SELECT t.session_id, s.project_id, t.content, t.status, t.priority,
            t.position, t.time_created, t.time_updated
       FROM todo t
       JOIN session s ON s.id = t.session_id
      ORDER BY t.session_id, t.position, t.time_created`,
  );
  const grouped = new Map<string, SessionTodos>();
  const overall = emptyRollup();
  let unknownCount = 0;

  for (const row of rows) {
    const status = decodeStatus(row.status);
    if (filters.projectId !== undefined && row.project_id !== filters.projectId) continue;
    if (filters.status !== undefined && status !== filters.status) continue;
    const todo: OcTodo = {
      sessionId: row.session_id,
      content: row.content,
      status,
      priority: row.priority,
      position: row.position,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    };
    const session = grouped.get(row.session_id) ?? {
      sessionId: row.session_id,
      projectId: row.project_id,
      todos: [],
      rollup: emptyRollup(),
    };
    session.todos.push(todo);
    add(session.rollup, status);
    add(overall, status);
    grouped.set(row.session_id, session);
    if (status === "unknown") unknownCount += 1;
  }

  return {
    data: { sessions: [...grouped.values()], rollup: overall },
    warnings: unknownCount > 0
      ? [{ code: "unknown-todo-status", message: "Todos had an unrecognised status", count: unknownCount }]
      : [],
  };
}

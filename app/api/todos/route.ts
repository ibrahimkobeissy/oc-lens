import { NextResponse } from "next/server";
import { getConnection } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { readTodos } from "@/lib/queries/todos";
import type { TodosRouteResponse, TodoStatus } from "@/types/oc";

export const dynamic = "force-dynamic";

function error(code: string, message: string, status: number): NextResponse<TodosRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request): Promise<NextResponse<TodosRouteResponse>> {
  const params = new URL(request.url).searchParams;
  const requestedStatus = params.get("status"); const project = params.get("project");
  if (requestedStatus !== null && !["pending", "in_progress", "completed", "unknown"].includes(requestedStatus)) return error("invalid_status", "status must be pending, in_progress, completed, or unknown", 400);
  try {
    const connection = getConnection();
    if (!connection.ok) {
      if (connection.reason === "not-found") return error("database_not_found", "No opencode database was found.", 404);
      return error("schema_mismatch", `Database schema does not match ${schemaVersion}.`, 409);
    }
    const { data, warnings } = readTodos(connection.db, {
      projectId: project ?? undefined,
      status: (requestedStatus ?? undefined) as TodoStatus | undefined,
    });
    return NextResponse.json({ data, meta: { generatedAt: Date.now(), schemaVersion, warnings } });
  } catch {
    return error("todos_failed", "Todos could not be read from the opencode database.", 500);
  }
}

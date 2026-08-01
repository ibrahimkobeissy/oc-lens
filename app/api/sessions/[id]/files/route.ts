import { NextResponse } from "next/server";

import { getConnection, query } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { fileChanges } from "@/lib/queries/tools";
import type { SessionFilesRouteResponse } from "@/types/oc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface SessionProjectRow {
  worktree: string | null;
}

const MAX_SESSION_ID_LENGTH = 512;

function validSessionId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_SESSION_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
}

function errorResponse(code: string, message: string, status: number): NextResponse<SessionFilesRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse<SessionFilesRouteResponse>> {
  const { id } = await context.params;
  if (!validSessionId(id)) return errorResponse("invalid_session_id", "The session id is invalid.", 400);

  try {
    const connection = getConnection();
    if (!connection.ok) {
      if (connection.reason === "not-found") {
        return errorResponse("database_not_found", "No opencode database was found. Check the database location in Settings.", 404);
      }
      return errorResponse("schema_mismatch", "The opencode database schema is not supported by this version of oc-lens.", 409);
    }

    const session = query<SessionProjectRow>(connection.db, `
      SELECT p.worktree
      FROM session s
      LEFT JOIN project p ON p.id = s.project_id
      WHERE s.id = ?
    `, [id])[0];
    if (!session) return errorResponse("session_not_found", `Session ${id} was not found.`, 404);

    const result = fileChanges(connection.db, id);
    return NextResponse.json({
      data: { changes: result.data, projectWorktree: session.worktree },
      meta: { generatedAt: Date.now(), schemaVersion, warnings: result.warnings },
    });
  } catch {
    return errorResponse("session_files_failed", "The session file timeline could not be read.", 500);
  }
}

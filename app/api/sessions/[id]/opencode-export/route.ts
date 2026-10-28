import { NextResponse } from "next/server";

import { getConnection } from "@/lib/db/connection";
import { sessionTransfer, transferFileName } from "@/lib/queries/session-transfer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface ErrorBody {
  error: { code: string; message: string };
}

const MAX_SESSION_ID_LENGTH = 512;

function validSessionId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_SESSION_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
}

function errorResponse(code: string, message: string, status: number): NextResponse<ErrorBody> {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * One session in the format `opencode session import <file>` reads
 * (data-model §8.6). Served as a download; nothing is written anywhere (D2).
 */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
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

    const result = sessionTransfer(connection.db, id);
    if (!result.ok) {
      switch (result.reason) {
        case "not-found":
          return errorResponse("session_not_found", `Session ${id} was not found.`, 404);
        case "no-v2-tables":
          return errorResponse("export_unavailable", "This database was written by opencode 1.x. Exports use the opencode 2.x import format; open the database with opencode 2.x once to upgrade it.", 409);
        case "legacy-only":
          return errorResponse("export_unavailable", "This session has not been migrated to opencode 2.x yet, so it cannot be exported in the 2.x import format.", 409);
        case "unreadable":
          return errorResponse("session_unreadable", "A record in this session is not valid JSON, so a complete export could not be produced.", 422);
      }
    }

    return new Response(JSON.stringify(result.data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${transferFileName(id)}"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return errorResponse("session_export_failed", "The session could not be exported.", 500);
  }
}

import { NextResponse } from "next/server";

import { getConnection, query } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { readPricing } from "@/lib/pricing/config";
import { sessionFailureReport, type SessionFailureReport } from "@/lib/queries/failures";
import type { OcResponse } from "@/types/oc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SessionFailuresRouteResponse = OcResponse<SessionFailureReport>;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MAX_SESSION_ID_LENGTH = 512;

function validSessionId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_SESSION_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
}

function errorResponse(code: string, message: string, status: number): NextResponse<SessionFailuresRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Failed provider calls in one session, the resends after them, and what they added (lib/queries/failures.ts). */
export async function GET(_request: Request, context: RouteContext): Promise<NextResponse<SessionFailuresRouteResponse>> {
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
    if (query(connection.db, "SELECT 1 FROM session WHERE id = ?", [id]).length === 0) {
      return errorResponse("session_not_found", `Session ${id} was not found.`, 404);
    }
    const data = sessionFailureReport(connection.db, readPricing(), id);
    return NextResponse.json({ data, meta: { generatedAt: Date.now(), schemaVersion, warnings: [] } });
  } catch {
    return errorResponse("session_failures_failed", "The session's failed calls could not be read.", 500);
  }
}

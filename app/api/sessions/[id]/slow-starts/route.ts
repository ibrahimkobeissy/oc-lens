import { NextResponse } from "next/server";

import { getConnection, query } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { slowStartReport, type SlowStartReport } from "@/lib/queries/slow-starts";
import type { OcResponse } from "@/types/oc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SessionSlowStartsRouteResponse = OcResponse<SlowStartReport>;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MAX_SESSION_ID_LENGTH = 512;

function validSessionId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_SESSION_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
}

function errorResponse(code: string, message: string, status: number): NextResponse<SessionSlowStartsRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** One session's slow starts, judged against each model's all-time usual wait (lib/queries/slow-starts.ts). */
export async function GET(request: Request, context: RouteContext): Promise<NextResponse<SessionSlowStartsRouteResponse>> {
  const { id } = await context.params;
  if (!validSessionId(id)) return errorResponse("invalid_session_id", "The session id is invalid.", 400);
  const timeZone = new URL(request.url).searchParams.get("tz") ?? "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
  } catch {
    return errorResponse("invalid_timezone", "Timezone must be a valid IANA timezone.", 400);
  }

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
    const data = slowStartReport(connection.db, timeZone, {}, id);
    return NextResponse.json({ data, meta: { generatedAt: Date.now(), schemaVersion, warnings: [] } });
  } catch {
    return errorResponse("session_slow_starts_failed", "The session's slow starts could not be read.", 500);
  }
}

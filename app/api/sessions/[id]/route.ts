import { NextResponse } from "next/server";

import { getConnection } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { readPricing } from "@/lib/pricing/config";
import { getSession } from "@/lib/queries/sessions";
import type { OcErrorEnvelope, SessionRouteResponse } from "@/types/oc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function errorResponse(code: string, message: string, status: number): NextResponse<OcErrorEnvelope> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse<SessionRouteResponse>> {
  const { id } = await context.params;
  if (!id.trim()) return errorResponse("invalid_session_id", "A session id is required.", 400);

  try {
    const connection = getConnection();
    if (!connection.ok) {
      if (connection.reason === "not-found") {
        return errorResponse("database_not_found", "No opencode database was found. Check the database location in Settings.", 404);
      }
      return errorResponse("schema_mismatch", "The opencode database schema is not supported by this version of oc-lens.", 409);
    }

    const result = getSession(connection.db, id, readPricing());
    if (!result.data) return errorResponse("session_not_found", `Session "${id}" was not found.`, 404);
    return NextResponse.json({
      data: result.data,
      meta: { generatedAt: Date.now(), schemaVersion, warnings: result.warnings },
    });
  } catch {
    return errorResponse("session_failed", "The session could not be read from the opencode database.", 500);
  }
}

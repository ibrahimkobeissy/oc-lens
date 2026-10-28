import { NextResponse } from "next/server";

import { getConnection } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { readPricing } from "@/lib/pricing/config";
import { parseCostsQuery } from "@/lib/pricing/range";
import { failureReport, type FailuresReport } from "@/lib/queries/failures";
import type { OcResponse } from "@/types/oc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type FailuresRouteResponse = OcResponse<FailuresReport>;

function errorResponse(code: string, message: string, status: number): NextResponse<FailuresRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Failed provider calls, the resends after them, and what the recovering step paid. Same `range`/`tz` as `/api/costs`. */
export async function GET(request: Request): Promise<NextResponse<FailuresRouteResponse>> {
  const generatedAt = Date.now();
  const parsed = parseCostsQuery(new URL(request.url).searchParams, generatedAt);
  if (!parsed.ok) return errorResponse(parsed.code, parsed.message, 400);

  try {
    const connection = getConnection();
    if (!connection.ok) {
      if (connection.reason === "not-found") {
        return errorResponse("database_not_found", "No opencode database was found. Check the database location in Settings.", 404);
      }
      return errorResponse("schema_mismatch", `The opencode database schema is not supported by ${schemaVersion}.`, 409);
    }
    const data = failureReport(connection.db, readPricing(), parsed.timeZone, parsed.range);
    return NextResponse.json({ data, meta: { generatedAt, schemaVersion, warnings: [] } });
  } catch {
    return errorResponse("failures_failed", "Failed provider calls could not be read from the opencode database.", 500);
  }
}

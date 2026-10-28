import { NextResponse } from "next/server";

import { getConnection } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { parseCostsQuery } from "@/lib/pricing/range";
import { slowStartReport, type SlowStartReport } from "@/lib/queries/slow-starts";
import type { OcResponse } from "@/types/oc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SlowStartsRouteResponse = OcResponse<SlowStartReport>;

function errorResponse(code: string, message: string, status: number): NextResponse<SlowStartsRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Steps that waited far longer than usual for their first token — possible hidden retries. Same `range`/`tz` as `/api/costs`. */
export async function GET(request: Request): Promise<NextResponse<SlowStartsRouteResponse>> {
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
    const data = slowStartReport(connection.db, parsed.timeZone, parsed.range);
    return NextResponse.json({ data, meta: { generatedAt, schemaVersion, warnings: [] } });
  } catch {
    return errorResponse("slow_starts_failed", "Slow starts could not be read from the opencode database.", 500);
  }
}

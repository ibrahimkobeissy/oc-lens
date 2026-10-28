import { NextResponse } from "next/server";

import { getConnection } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { dailyUsage, type DailyUsageRow } from "@/lib/pricing/breakdown";
import { readPricing } from "@/lib/pricing/config";
import { parseCostsQuery } from "@/lib/pricing/range";
import type { OcResponse } from "@/types/oc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DailyUsageRouteResponse = OcResponse<DailyUsageRow[]>;

function errorResponse(code: string, message: string, status: number): NextResponse<DailyUsageRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Per-day tokens and cost for the Costs page's selected range; same query parameters as `/api/costs`. */
export async function GET(request: Request): Promise<NextResponse<DailyUsageRouteResponse>> {
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
    const data = dailyUsage(connection.db, readPricing(), parsed.timeZone, parsed.range);
    return NextResponse.json({ data, meta: { generatedAt, schemaVersion, warnings: [] } });
  } catch {
    return errorResponse("daily_costs_failed", "Daily costs could not be read from the opencode database.", 500);
  }
}

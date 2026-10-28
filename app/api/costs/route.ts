import { NextResponse } from "next/server";

import { getConnection, query } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { decodeMessageData } from "@/lib/decode/message";
import { mergeWarnings } from "@/lib/decode/warnings";
import { costBreakdown } from "@/lib/pricing/breakdown";
import { readPricing } from "@/lib/pricing/config";
import { storedCostInRange } from "@/lib/pricing/cost";
import { parseCostsQuery } from "@/lib/pricing/range";
import type { CostBreakdown, CostsRouteResponse } from "@/types/oc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface MessageDataRow {
  time_created: number;
  data: string | null;
}

function errorResponse(code: string, message: string, status: number): NextResponse<CostsRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

function messageWarningsInRange(db: Parameters<typeof costBreakdown>[0], range: { from?: number; to?: number }) {
  const warnings = query<MessageDataRow>(db, "SELECT time_created, data FROM message")
    .filter((row) =>
      (range.from === undefined || row.time_created >= range.from) &&
      (range.to === undefined || row.time_created < range.to))
    .flatMap((row) => decodeMessageData(row.data).warnings);
  return mergeWarnings([warnings]);
}

export async function GET(request: Request): Promise<NextResponse<CostsRouteResponse>> {
  const generatedAt = Date.now();
  const parsed = parseCostsQuery(new URL(request.url).searchParams, generatedAt);
  if (!parsed.ok) return errorResponse(parsed.code, parsed.message, 400);
  const { range, timeZone } = parsed;

  try {
    const connection = getConnection();
    if (!connection.ok) {
      if (connection.reason === "not-found") {
        return errorResponse("database_not_found", "No opencode database was found. Check the database location in Settings.", 404);
      }
      return errorResponse("schema_mismatch", `The opencode database schema is not supported by ${schemaVersion}.`, 409);
    }

    const calculated = costBreakdown(connection.db, readPricing(), timeZone, range);
    const data: CostBreakdown = {
      ...calculated,
      // costBreakdown's stored comparison is intentionally all-time; a ranged
      // HTTP response must compare like with like, so scope it at the adapter.
      storedCostComparison: storedCostInRange(connection.db, range),
    };
    return NextResponse.json({
      data,
      meta: { generatedAt, schemaVersion, warnings: messageWarningsInRange(connection.db, range) },
    });
  } catch {
    return errorResponse("costs_failed", "Costs could not be read from the opencode database.", 500);
  }
}

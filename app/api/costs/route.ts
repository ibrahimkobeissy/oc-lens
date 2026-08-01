import { NextResponse } from "next/server";

import { getConnection, query } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { decodeMessageData } from "@/lib/decode/message";
import { mergeWarnings } from "@/lib/decode/warnings";
import { costBreakdown } from "@/lib/pricing/breakdown";
import { readPricing } from "@/lib/pricing/config";
import type { CostBreakdown, CostsRouteResponse } from "@/types/oc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAY_MS = 86_400_000;
const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;
type CostsRange = keyof typeof RANGE_DAYS | "all";

interface StoredCostRow {
  cost: number | null;
}

interface MessageDataRow {
  time_created: number;
  data: string | null;
}

function errorResponse(code: string, message: string, status: number): NextResponse<CostsRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

function isRange(value: string): value is CostsRange {
  return value === "all" || Object.hasOwn(RANGE_DAYS, value);
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Provider-reported session cost for the same half-open range as the computed message costs. */
function storedCostInRange(db: Parameters<typeof costBreakdown>[0], range: { from?: number; to?: number }): number {
  const clauses: string[] = [];
  const params: number[] = [];
  if (range.from !== undefined) { clauses.push("time_created >= ?"); params.push(range.from); }
  if (range.to !== undefined) { clauses.push("time_created < ?"); params.push(range.to); }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  return query<StoredCostRow>(db, `SELECT cost FROM session${where}`, params)
    .reduce((sum, row) => sum + (row.cost ?? 0), 0);
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
  const params = new URL(request.url).searchParams;
  const rangeName = params.get("range") ?? "30d";
  const timeZone = params.get("tz") ?? "UTC";
  if (!isRange(rangeName)) {
    return errorResponse("invalid_range", "Range must be one of 7d, 30d, 90d, or all.", 400);
  }
  if (!isTimeZone(timeZone)) {
    return errorResponse("invalid_timezone", "Timezone must be a valid IANA timezone.", 400);
  }

  try {
    const connection = getConnection();
    if (!connection.ok) {
      if (connection.reason === "not-found") {
        return errorResponse("database_not_found", "No opencode database was found. Check the database location in Settings.", 404);
      }
      return errorResponse("schema_mismatch", `The opencode database schema is not supported by ${schemaVersion}.`, 409);
    }

    const generatedAt = Date.now();
    const range = rangeName === "all"
      ? {}
      : { from: generatedAt - RANGE_DAYS[rangeName] * DAY_MS, to: generatedAt + 1 };
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

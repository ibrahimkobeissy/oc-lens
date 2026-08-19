import { NextResponse } from "next/server";

import { getConnection } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { detectLoops } from "@/lib/queries/loops";
import { readPricing } from "@/lib/pricing/config";
import type { PartQueryFilter } from "@/lib/queries/tools";
import type { LoopsRouteResponse } from "@/types/oc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1_000;
const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;
type LoopsRange = keyof typeof RANGE_DAYS | "all";

/** Upper bound on `minRepeats`, so a query string cannot ask for an absurd threshold. */
const MAX_MIN_REPEATS = 100;

function errorResponse(code: string, message: string, status: number): NextResponse<LoopsRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

function isLoopsRange(value: string): value is LoopsRange {
  return value === "all" || Object.hasOwn(RANGE_DAYS, value);
}

export async function GET(request: Request): Promise<NextResponse<LoopsRouteResponse>> {
  const params = new URL(request.url).searchParams;
  const range = params.get("range") ?? "30d";
  if (!isLoopsRange(range)) {
    return errorResponse("invalid_range", "Range must be one of 7d, 30d, 90d, or all.", 400);
  }

  const rawMinRepeats = params.get("minRepeats");
  let minRepeats: number | undefined;
  if (rawMinRepeats !== null) {
    const value = Number(rawMinRepeats);
    if (!Number.isInteger(value) || value < 2 || value > MAX_MIN_REPEATS) {
      return errorResponse(
        "invalid_min_repeats",
        `minRepeats must be an integer from 2 to ${MAX_MIN_REPEATS}.`,
        400,
      );
    }
    minRepeats = value;
  }

  try {
    const connection = getConnection();
    if (!connection.ok) {
      if (connection.reason === "not-found") {
        return errorResponse(
          "database_not_found",
          "No opencode database was found. Check the database location in Settings.",
          404,
        );
      }
      return errorResponse(
        "schema_mismatch",
        `The opencode database schema is not supported by ${schemaVersion}.`,
        409,
      );
    }

    const generatedAt = Date.now();
    // A session scope is absolute: replay shows one session's whole history,
    // so a rolling range would hide loops in anything older than the window.
    const sessionId = params.get("sessionId");
    const filter: PartQueryFilter = sessionId !== null
      ? { sessionId }
      : range === "all"
        ? {}
        : { from: generatedAt - RANGE_DAYS[range] * DAY_MS, to: generatedAt + 1 };

    const pricing = readPricing();
    const loops = detectLoops(connection.db, filter, pricing, minRepeats === undefined ? {} : { minRepeats });
    return NextResponse.json({
      data: loops.data,
      meta: { generatedAt, schemaVersion, warnings: loops.warnings },
    });
  } catch {
    return errorResponse("loops_failed", "Loop analysis could not be read from the opencode database.", 500);
  }
}

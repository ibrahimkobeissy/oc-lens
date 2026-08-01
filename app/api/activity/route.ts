import { NextResponse } from "next/server";

import { getConnection } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { mergeWarnings } from "@/lib/decode/warnings";
import { dailyActivity, dayOfWeek, hourOfDay, streaks, type TimeRange } from "@/lib/queries/activity";
import type { ActivityRouteResponse, ActivityStats } from "@/types/oc";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1_000;
const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;
type ActivityRange = keyof typeof RANGE_DAYS | "all";

function errorResponse(code: string, message: string, status: number): NextResponse<ActivityRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

function isActivityRange(value: string): value is ActivityRange {
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

export async function GET(request: Request): Promise<NextResponse<ActivityRouteResponse>> {
  const params = new URL(request.url).searchParams;
  const range = params.get("range") ?? "30d";
  const timeZone = params.get("tz") ?? "UTC";

  if (!isActivityRange(range)) {
    return errorResponse("invalid_range", "Range must be one of 7d, 30d, 90d, or all.", 400);
  }
  if (!isTimeZone(timeZone)) {
    return errorResponse("invalid_timezone", "Timezone must be a valid IANA timezone.", 400);
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
    const queryRange: TimeRange = {
      timeZone,
      ...(range === "all"
        ? {}
        : { from: generatedAt - RANGE_DAYS[range] * DAY_MS, to: generatedAt + 1 }),
    };
    const daily = dailyActivity(connection.db, queryRange);
    const hourly = hourOfDay(connection.db, queryRange);
    const weekly = dayOfWeek(connection.db, queryRange);
    const streak = streaks(connection.db, timeZone, generatedAt, queryRange);
    const data: ActivityStats = {
      dailyActivity: daily.data,
      hourOfDay: hourly.data,
      dayOfWeek: weekly.data,
      streaks: streak.data,
    };

    return NextResponse.json({
      data,
      meta: {
        generatedAt,
        schemaVersion,
        // `streaks` derives its warning list by calling `dailyActivity` again.
        // Merging it here would count the same malformed part twice.
        warnings: mergeWarnings([daily.warnings, hourly.warnings, weekly.warnings]),
      },
    });
  } catch {
    return errorResponse("activity_failed", "Activity could not be read from the opencode database.", 500);
  }
}

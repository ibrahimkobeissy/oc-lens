import { NextResponse } from "next/server";

import { getConnection } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { skillUsage, type PartQueryFilter } from "@/lib/queries/tools";
import type { SkillsRouteResponse } from "@/types/oc";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1_000;
const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;
type SkillsRange = keyof typeof RANGE_DAYS | "all";

function errorResponse(code: string, message: string, status: number): NextResponse<SkillsRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

function isSkillsRange(value: string): value is SkillsRange {
  return value === "all" || Object.hasOwn(RANGE_DAYS, value);
}

export async function GET(request: Request): Promise<NextResponse<SkillsRouteResponse>> {
  const range = new URL(request.url).searchParams.get("range") ?? "30d";
  if (!isSkillsRange(range)) {
    return errorResponse("invalid_range", "Range must be one of 7d, 30d, 90d, or all.", 400);
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
    const filter: PartQueryFilter = range === "all"
      ? {}
      : { from: generatedAt - RANGE_DAYS[range] * DAY_MS, to: generatedAt };
    const skills = skillUsage(connection.db, filter);
    return NextResponse.json({
      data: skills.data,
      meta: { generatedAt, schemaVersion, warnings: skills.warnings },
    });
  } catch {
    return errorResponse("skills_failed", "Skill analytics could not be read from the opencode database.", 500);
  }
}

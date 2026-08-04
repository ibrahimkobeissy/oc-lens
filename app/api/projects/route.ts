import { NextResponse } from "next/server";

import { getConnection } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { readPricing } from "@/lib/pricing/config";
import { listProjects } from "@/lib/queries/projects";
import type { ProjectsRouteResponse } from "@/types/oc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(code: string, message: string, status: number): NextResponse<ProjectsRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(): Promise<NextResponse<ProjectsRouteResponse>> {
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
        "The opencode database schema is not supported by this version of oc-lens.",
        409,
      );
    }

    const result = listProjects(connection.db, {}, readPricing());
    return NextResponse.json({
      data: result.data,
      meta: { generatedAt: Date.now(), schemaVersion, warnings: result.warnings },
    });
  } catch {
    return errorResponse("projects_failed", "Projects could not be read from the opencode database.", 500);
  }
}

import { NextResponse } from "next/server";

import { getConnection } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { loopDiagnostics } from "@/lib/diagnostics/loop-report";
import type { PartQueryFilter } from "@/lib/queries/tools";
import type { OcResponse, LoopDiagnosticsReport } from "@/types/oc";

/**
 * Loop-detection calibration evidence, for carrying to a machine with enough
 * history to tune thresholds against.
 *
 *   curl -s http://127.0.0.1:3000/api/diagnostics/loops > oc-lens-diagnostics.json
 *
 * The payload is shape-only — tool names, input key names, their JSON types,
 * counts and histograms. See `loopDiagnostics` for the redaction policy, which
 * is also restated inside the response so the file is self-describing.
 */

export const dynamic = "force-dynamic";

type DiagnosticsRouteResponse = OcResponse<LoopDiagnosticsReport>;

function errorResponse(code: string, message: string, status: number): NextResponse<DiagnosticsRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request): Promise<NextResponse<DiagnosticsRouteResponse>> {
  const params = new URL(request.url).searchParams;
  const filter: PartQueryFilter = {};

  for (const key of ["from", "to"] as const) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return errorResponse("invalid_range", `${key} must be an epoch-millisecond integer.`, 400);
    }
    filter[key] = value;
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
    const report = loopDiagnostics(connection.db, filter);
    return NextResponse.json({
      data: report.data,
      meta: { generatedAt, schemaVersion, warnings: report.warnings },
    });
  } catch {
    return errorResponse(
      "diagnostics_failed",
      "Loop diagnostics could not be read from the opencode database.",
      500,
    );
  }
}

import { NextResponse } from "next/server";

import { getConnection } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { mergeWarnings } from "@/lib/decode/warnings";
import { readPricing } from "@/lib/pricing/config";
import { agentActivity, agentSwitchEvents, agentUsage } from "@/lib/queries/agents";
import type { AgentsResponse, AgentsRouteResponse } from "@/types/oc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(code: string, message: string, status: number): NextResponse<AgentsRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(): Promise<NextResponse<AgentsRouteResponse>> {
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

    const usage = agentUsage(connection.db, {}, readPricing());
    const activity = agentActivity(connection.db);
    const switches = agentSwitchEvents(connection.db);
    const data: AgentsResponse = {
      agents: usage.data,
      activity: activity.data,
      switches: switches.data,
    };
    const usageCodes = new Set(usage.warnings.map((warning) => warning.code));

    return NextResponse.json({
      data,
      meta: {
        generatedAt: Date.now(),
        schemaVersion,
        // Usage and activity decode the same messages. Keep usage canonical so
        // a malformed row is counted once, then add activity-only/switch caveats.
        warnings: mergeWarnings([
          usage.warnings,
          activity.warnings.filter((warning) => !usageCodes.has(warning.code)),
          switches.warnings,
        ]),
      },
    });
  } catch {
    return errorResponse("agents_failed", "Agent analytics could not be read from the opencode database.", 500);
  }
}

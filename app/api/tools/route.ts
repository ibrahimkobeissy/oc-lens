import { NextResponse } from "next/server";

import { readOpencodeConfig } from "@/lib/config/read";
import { redactConfig } from "@/lib/config/redact";
import { getConnection, query } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { versionHistory } from "@/lib/queries/projects";
import { featureAdoption, mcpUsage, skillUsage, toolErrors, toolUsage, type PartQueryFilter } from "@/lib/queries/tools";
import type { ToolsRouteResponse, ToolsStats } from "@/types/oc";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1_000;
const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;
type ToolsRange = keyof typeof RANGE_DAYS | "all";

interface WorktreeRow {
  worktree: string | null;
}

function errorResponse(code: string, message: string, status: number): NextResponse<ToolsRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

function isToolsRange(value: string): value is ToolsRange {
  return value === "all" || Object.hasOwn(RANGE_DAYS, value);
}

export async function GET(request: Request): Promise<NextResponse<ToolsRouteResponse>> {
  const range = new URL(request.url).searchParams.get("range") ?? "30d";
  if (!isToolsRange(range)) {
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
    const worktrees = query<WorktreeRow>(
      connection.db,
      "SELECT worktree FROM project WHERE worktree IS NOT NULL AND worktree <> '' ORDER BY worktree",
    ).flatMap((row) => row.worktree === null ? [] : [row.worktree]);
    const config = readOpencodeConfig({ projectWorktrees: worktrees });
    const servers = config ? redactConfig(config).mcpServers.map((server) => server.name) : [];

    const tools = toolUsage(connection.db, filter);
    const errors = toolErrors(connection.db, filter);
    const mcpServers = mcpUsage(connection.db, servers, filter);
    const skills = skillUsage(connection.db, filter);
    const adoption = featureAdoption(connection.db, servers, filter);
    const versions = versionHistory(connection.db, filter);
    const data: ToolsStats = {
      tools: tools.data,
      errors: errors.data,
      mcpServers: mcpServers.data,
      skills: skills.data,
      featureAdoption: adoption.data,
      versionHistory: versions.data,
    };

    return NextResponse.json({
      data,
      meta: {
        generatedAt,
        schemaVersion,
        // These helpers decode the same part rows. Keep the tool stream
        // canonical, then add adoption-only message warnings by code.
        warnings: [
          ...tools.warnings,
          ...adoption.warnings.filter(
            (warning) => !tools.warnings.some((toolWarning) => toolWarning.code === warning.code),
          ),
        ],
      },
    });
  } catch {
    return errorResponse("tools_failed", "Tool analytics could not be read from the opencode database.", 500);
  }
}

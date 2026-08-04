import { NextResponse } from "next/server";

import { getConnection, query } from "@/lib/db/connection";
import { mergeWarnings } from "@/lib/decode/warnings";
import { schemaVersion } from "@/lib/db/schema-guard";
import { readPricing } from "@/lib/pricing/config";
import { dailyActivity } from "@/lib/queries/activity";
import { listProjects, projectModelBreakdown } from "@/lib/queries/projects";
import { listSessions } from "@/lib/queries/sessions";
import type { ProjectDetail, ProjectRouteResponse } from "@/types/oc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface WorkspaceRow {
  branch: string | null;
}

interface TableRow {
  name: string;
}

const MAX_PROJECT_ID_LENGTH = 512;

function errorResponse(code: string, message: string, status: number): NextResponse<ProjectRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

function validProjectId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_PROJECT_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse<ProjectRouteResponse>> {
  const { id } = await context.params;
  if (!validProjectId(id)) return errorResponse("invalid_project_id", "The project id is invalid.", 400);
  const timeZone = new URL(request.url).searchParams.get("tz") ?? "UTC";
  if (!validTimeZone(timeZone)) return errorResponse("invalid_timezone", "tz must be a valid IANA timezone.", 400);

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

    const pricing = readPricing();
    const sessions = listSessions(connection.db, { projectId: id }, pricing);
    const summary = listProjects(connection.db, { projectId: id }, pricing, sessions).data.find((project) => project.id === id);
    if (!summary) return errorResponse("project_not_found", `Project ${id} was not found.`, 404);

    const activity = dailyActivity(connection.db, { projectId: id, timeZone });
    const models = projectModelBreakdown(connection.db, id, pricing);
    const hasWorkspace = query<TableRow>(
      connection.db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspace'",
    ).length > 0;
    const workspaceRows = hasWorkspace
      ? query<WorkspaceRow>(
          connection.db,
          "SELECT branch FROM workspace WHERE project_id = ? ORDER BY branch, id",
          [id],
        )
      : [];
    const data: ProjectDetail = {
      ...summary,
      sessions: sessions.data,
      dailyActivity: activity.data,
      modelBreakdown: models.data,
      ...(workspaceRows.length > 0
        ? {
            branches: [...new Set(
              workspaceRows
                .map((row) => row.branch?.trim())
                .filter((branch): branch is string => branch !== undefined && branch.length > 0),
            )],
          }
        : {}),
    };

    return NextResponse.json({
      data,
      meta: {
        generatedAt: Date.now(),
        schemaVersion,
        warnings: mergeWarnings([
          sessions.warnings,
          activity.warnings,
          models.warnings.filter((warning) => !sessions.warnings.some((sessionWarning) => sessionWarning.code === warning.code)),
        ]),
      },
    });
  } catch {
    return errorResponse("project_failed", "The project could not be read from the opencode database.", 500);
  }
}

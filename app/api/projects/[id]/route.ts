import { NextResponse } from "next/server";

import { getConnection, query } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { dailyActivity } from "@/lib/queries/activity";
import { listProjects } from "@/lib/queries/projects";
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

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse<ProjectRouteResponse>> {
  const { id } = await context.params;
  if (!validProjectId(id)) return errorResponse("invalid_project_id", "The project id is invalid.", 400);

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

    const sessions = listSessions(connection.db, { projectId: id });
    const summary = listProjects(connection.db, { projectId: id }, sessions).data.find((project) => project.id === id);
    if (!summary) return errorResponse("project_not_found", `Project ${id} was not found.`, 404);

    const activity = dailyActivity(connection.db, { projectId: id, timeZone: "UTC" });
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
      // Both aggregates decode the same project part rows. The session warning
      // stream is canonical so malformed rows are not counted twice.
      meta: { generatedAt: Date.now(), schemaVersion, warnings: sessions.warnings },
    });
  } catch {
    return errorResponse("project_failed", "The project could not be read from the opencode database.", 500);
  }
}

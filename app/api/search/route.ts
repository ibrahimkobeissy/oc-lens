import type { DatabaseSync } from "node:sqlite";
import { NextResponse } from "next/server";

import { getConnection, query } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { listSessions, projectDisplayName } from "@/lib/queries/sessions";
import type { OcResponse } from "@/types/oc";

const RESULT_LIMIT = 20;
const MAX_QUERY_LENGTH = 200;

export interface SearchSessionResult {
  id: string;
  slug: string;
  title: string;
  projectId: string;
  projectDisplayName: string;
}

export interface SearchProjectResult {
  id: string;
  displayName: string;
  worktree: string;
  sessionCount: number;
}

export interface SearchData {
  sessions: SearchSessionResult[];
  projects: SearchProjectResult[];
  totals: {
    sessions: number;
    projects: number;
  };
}

export type SearchApiResponse = OcResponse<SearchData>;

function errorResponse(code: string, message: string, status: number): NextResponse<SearchApiResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** The query work is separate from the HTTP adapter so it can be timed against the fixture DB. */
function searchDatabase(db: DatabaseSync, searchQuery: string): {
  data: SearchData;
  warnings: ReturnType<typeof listSessions>["warnings"];
} {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return {
      data: { sessions: [], projects: [], totals: { sessions: 0, projects: 0 } },
      warnings: [],
    };
  }

  const sessionResult = listSessions(db, { search: normalizedQuery });
  interface ProjectSearchRow {
    id: string;
    name: string | null;
    worktree: string | null;
    session_count: number;
  }
  const term = `%${normalizedQuery}%`;
  const matchingProjects = query<ProjectSearchRow>(db, `
    SELECT p.id, p.name, p.worktree, COUNT(s.id) AS session_count
    FROM project p LEFT JOIN session s ON s.project_id = p.id
    WHERE LOWER(p.id) LIKE ? OR LOWER(COALESCE(p.name, p.worktree, '')) LIKE ?
    GROUP BY p.id, p.name, p.worktree
    ORDER BY COALESCE(p.name, p.worktree, p.id), p.id
  `, [term, term]);

  return {
    data: {
      sessions: sessionResult.data.slice(0, RESULT_LIMIT).map((session) => ({
        id: session.id,
        slug: session.slug,
        title: session.title,
        projectId: session.projectId,
        projectDisplayName: session.projectDisplayName,
      })),
      projects: matchingProjects.slice(0, RESULT_LIMIT).map((project) => ({
        id: project.id,
        displayName: projectDisplayName(project.id, project.name, project.worktree),
        worktree: project.worktree ?? "",
        sessionCount: project.session_count,
      })),
      totals: {
        sessions: sessionResult.data.length,
        projects: matchingProjects.length,
      },
    },
    warnings: sessionResult.warnings,
  };
}

export async function GET(request: Request): Promise<NextResponse<SearchApiResponse>> {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length > MAX_QUERY_LENGTH) {
    return errorResponse("invalid_query", `Search queries must be ${MAX_QUERY_LENGTH} characters or fewer`, 400);
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
        "The opencode database schema is not supported by this version of oc-lens.",
        409,
      );
    }

    const result = searchDatabase(connection.db, query);
    return NextResponse.json({
      data: result.data,
      meta: {
        generatedAt: Date.now(),
        schemaVersion,
        warnings: result.warnings,
      },
    });
  } catch {
    return errorResponse("search_failed", "Search could not read the opencode database.", 500);
  }
}

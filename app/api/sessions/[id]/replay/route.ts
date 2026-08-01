import { NextResponse } from "next/server";

import { readOpencodeConfig } from "@/lib/config/read";
import { redactConfig } from "@/lib/config/redact";
import { getConnection, query } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { readPricing } from "@/lib/pricing/config";
import { getReplay } from "@/lib/queries/replay";
import type { SessionReplayRouteResponse } from "@/types/oc";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface WorktreeRow {
  worktree: string;
}

const MAX_SESSION_ID_LENGTH = 512;
const STREAM_THRESHOLD_BYTES = 2 * 1024 * 1024;
const STREAM_CHUNK_BYTES = 64 * 1024;

function errorResponse(code: string, message: string, status: number): NextResponse<SessionReplayRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

function validSessionId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_SESSION_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
}

function replayResponse(payload: SessionReplayRouteResponse): NextResponse<SessionReplayRouteResponse> {
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  if (encoded.byteLength <= STREAM_THRESHOLD_BYTES) return NextResponse.json(payload);

  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= encoded.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + STREAM_CHUNK_BYTES, encoded.byteLength);
      controller.enqueue(encoded.subarray(offset, end));
      offset = end;
    },
  });
  return new NextResponse(stream, { headers: { "content-type": "application/json" } });
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse<SessionReplayRouteResponse>> {
  const { id } = await context.params;
  if (!validSessionId(id)) {
    return errorResponse("invalid_session_id", "The session id is invalid.", 400);
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

    const projectWorktrees = query<WorktreeRow>(
      connection.db,
      "SELECT worktree FROM project WHERE worktree IS NOT NULL AND worktree <> '' ORDER BY worktree",
    ).map((row) => row.worktree);
    const config = readOpencodeConfig({ projectWorktrees });
    const mcpServers = config ? redactConfig(config).mcpServers.map((server) => server.name) : [];
    const result = getReplay(connection.db, id, mcpServers, readPricing());

    if (result.data === null) {
      return errorResponse("session_not_found", `Session ${id} was not found.`, 404);
    }

    return replayResponse({
      data: result.data,
      meta: {
        generatedAt: Date.now(),
        schemaVersion,
        warnings: result.warnings,
      },
    });
  } catch {
    return errorResponse("replay_failed", "The session replay could not be read.", 500);
  }
}

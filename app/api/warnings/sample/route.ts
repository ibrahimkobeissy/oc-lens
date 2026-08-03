import { NextResponse } from "next/server";

import { getConnection, query } from "@/lib/db/connection";
import { decodeMessageData } from "@/lib/decode/message";
import { decodePartData } from "@/lib/decode/part";
import { decodeSessionModel, decodeSessionPermission } from "@/lib/decode/session";
import { schemaVersion } from "@/lib/db/schema-guard";
import type { OcMeta } from "@/types/oc";

export const dynamic = "force-dynamic";

/**
 * On-demand support for the "Report on GitHub" flow (components/states/warnings-banner.tsx):
 * given a warning code already surfaced by a page's own `meta.warnings`, finds one real
 * row that produced it and returns its raw column value verbatim, so a user reporting a
 * data-shape gap doesn't have to hand-run a SQL query themselves. Read-only, and only ever
 * touches `part`/`message`/`session` — the same tables every other query in this app reads.
 */

const MAX_RAW_CHARS = 4_000;

const PART_CODES = new Set(["malformed-part-data", "malformed-compaction", "malformed-patch", "unknown-part-type", "unknown-tool-status"]);
const MESSAGE_CODES = new Set(["malformed-message-data", "unknown-message-role"]);
const SESSION_MODEL_CODES = new Set(["malformed-session-model"]);
const SESSION_PERMISSION_CODES = new Set(["malformed-session-permission", "malformed-session-permission-item"]);

interface WarningSampleData {
  code: string;
  found: boolean;
  sourceId: string | null;
  raw: string | null;
  truncated: boolean;
}

interface WarningSampleResponse {
  data?: WarningSampleData;
  meta?: OcMeta;
  error?: { code: string; message: string };
}

interface RowWithData { id: string; data: string | null }
interface SessionModelRow { id: string; model: string | null }
interface SessionPermissionRow { id: string; permission: string | null }

function formatRaw(raw: string | null): { raw: string | null; truncated: boolean } {
  if (raw === null) return { raw: null, truncated: false };
  let text = raw;
  try {
    text = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // Not valid JSON (e.g. malformed-part-data) — show the raw text as-is.
  }
  if (text.length > MAX_RAW_CHARS) {
    return { raw: `${text.slice(0, MAX_RAW_CHARS)}\n… (truncated)`, truncated: true };
  }
  return { raw: text, truncated: false };
}

function found(code: string, sourceId: string, raw: string | null): WarningSampleResponse {
  const formatted = formatRaw(raw);
  return { data: { code, found: true, sourceId, raw: formatted.raw, truncated: formatted.truncated }, meta: { generatedAt: Date.now(), schemaVersion, warnings: [] } };
}

function notFound(code: string): WarningSampleResponse {
  return { data: { code, found: false, sourceId: null, raw: null, truncated: false }, meta: { generatedAt: Date.now(), schemaVersion, warnings: [] } };
}

function errorResponse(code: string, message: string, status: number): NextResponse<WarningSampleResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request): Promise<NextResponse<WarningSampleResponse>> {
  const code = new URL(request.url).searchParams.get("code");
  if (!code) return errorResponse("invalid_query", 'Query parameter "code" is required.', 400);

  const connection = getConnection();
  if (!connection.ok) {
    if (connection.reason === "not-found") {
      return errorResponse("database_not_found", "No opencode database was found. Check the database location in Settings.", 404);
    }
    return errorResponse("schema_mismatch", "The opencode database schema is not supported by this version of oc-lens.", 409);
  }
  const db = connection.db;

  if (PART_CODES.has(code)) {
    for (const row of query<RowWithData>(db, "SELECT id, data FROM part")) {
      if (decodePartData(row.data).warnings.some((w) => w.code === code)) return NextResponse.json(found(code, row.id, row.data));
    }
  } else if (MESSAGE_CODES.has(code)) {
    for (const row of query<RowWithData>(db, "SELECT id, data FROM message")) {
      if (decodeMessageData(row.data).warnings.some((w) => w.code === code)) return NextResponse.json(found(code, row.id, row.data));
    }
  } else if (SESSION_MODEL_CODES.has(code)) {
    for (const row of query<SessionModelRow>(db, "SELECT id, model FROM session WHERE model IS NOT NULL AND model != ''")) {
      if (decodeSessionModel(row.model).warnings.some((w) => w.code === code)) return NextResponse.json(found(code, row.id, row.model));
    }
  } else if (SESSION_PERMISSION_CODES.has(code)) {
    for (const row of query<SessionPermissionRow>(db, "SELECT id, permission FROM session WHERE permission IS NOT NULL AND permission != ''")) {
      if (decodeSessionPermission(row.permission).warnings.some((w) => w.code === code)) return NextResponse.json(found(code, row.id, row.permission));
    }
  }

  return NextResponse.json(notFound(code));
}

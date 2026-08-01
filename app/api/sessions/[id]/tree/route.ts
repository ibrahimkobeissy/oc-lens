import { NextResponse } from "next/server";

import { getConnection, query } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { decodeMessageData } from "@/lib/decode/message";
import { mergeWarnings } from "@/lib/decode/warnings";
import { costBreakdown } from "@/lib/pricing/breakdown";
import { readPricing } from "@/lib/pricing/config";
import { subagentTree } from "@/lib/queries/replay";
import type { OcCost, OcWarning, SubagentNode, SubagentTreeRouteResponse } from "@/types/oc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MAX_SESSION_ID_LENGTH = 512;
const UNPRICED: OcCost = { amount: 0, priced: false };

interface MessageDataRow {
  data: string | null;
}

function errorResponse(code: string, message: string, status: number): NextResponse<SubagentTreeRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

function validSessionId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_SESSION_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
}

function applySessionCosts(node: SubagentNode, costs: ReadonlyMap<string, OcCost>): SubagentNode {
  return {
    ...node,
    cost: costs.get(node.sessionId) ?? UNPRICED,
    children: node.children.map((child) => applySessionCosts(child, costs)),
  };
}

function pricingEvidenceWarnings(db: Parameters<typeof query>[0], tree: SubagentNode): OcWarning[] {
  const sessionIds: string[] = [];
  const visit = (node: SubagentNode): void => {
    sessionIds.push(node.sessionId);
    node.children.forEach(visit);
  };
  visit(tree);
  const placeholders = sessionIds.map(() => "?").join(", ");
  const warnings = query<MessageDataRow>(db, `SELECT data FROM message WHERE session_id IN (${placeholders})`, sessionIds)
    .flatMap((row) => decodeMessageData(row.data).warnings);
  return mergeWarnings([warnings]);
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse<SubagentTreeRouteResponse>> {
  const { id } = await context.params;
  if (!validSessionId(id)) return errorResponse("invalid_session_id", "The session id is invalid.", 400);

  try {
    const connection = getConnection();
    if (!connection.ok) {
      if (connection.reason === "not-found") {
        return errorResponse("database_not_found", "No opencode database was found. Check the database location in Settings.", 404);
      }
      return errorResponse("schema_mismatch", "The opencode database schema is not supported by this version of oc-lens.", 409);
    }

    const result = subagentTree(connection.db, id);
    if (result.data === null) return errorResponse("session_not_found", `Session ${id} was not found.`, 404);

    const bySession = new Map(
      costBreakdown(connection.db, readPricing()).bySession.map((entry) => [entry.sessionId, entry.cost]),
    );
    return NextResponse.json({
      data: applySessionCosts(result.data, bySession),
      meta: {
        generatedAt: Date.now(),
        schemaVersion,
        warnings: mergeWarnings([result.warnings, pricingEvidenceWarnings(connection.db, result.data)]),
      },
    });
  } catch {
    return errorResponse("subagent_tree_failed", "The subagent tree could not be read.", 500);
  }
}

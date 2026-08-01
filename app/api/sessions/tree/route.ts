import { NextResponse } from "next/server";

import { getConnection, query } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { decodeMessageData } from "@/lib/decode/message";
import { mergeWarnings } from "@/lib/decode/warnings";
import { costBreakdown } from "@/lib/pricing/breakdown";
import { readPricing } from "@/lib/pricing/config";
import { subagentTree } from "@/lib/queries/replay";
import type { OcCost, OcWarning, SubagentNode, SubagentRootsRouteResponse } from "@/types/oc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RootRow {
  id: string;
}

interface MessageDataRow {
  data: string | null;
}

const UNPRICED: OcCost = { amount: 0, priced: false };

function errorResponse(code: string, message: string, status: number): NextResponse<SubagentRootsRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

function applySessionCosts(node: SubagentNode, costs: ReadonlyMap<string, OcCost>): SubagentNode {
  return {
    ...node,
    cost: costs.get(node.sessionId) ?? UNPRICED,
    children: node.children.map((child) => applySessionCosts(child, costs)),
  };
}

function pricingEvidenceWarnings(db: Parameters<typeof query>[0], trees: readonly SubagentNode[]): OcWarning[] {
  const sessionIds = new Set<string>();
  const visit = (node: SubagentNode): void => {
    sessionIds.add(node.sessionId);
    node.children.forEach(visit);
  };
  trees.forEach(visit);
  if (sessionIds.size === 0) return [];
  const ids = [...sessionIds];
  const placeholders = ids.map(() => "?").join(", ");
  const warnings = query<MessageDataRow>(db, `SELECT data FROM message WHERE session_id IN (${placeholders})`, ids)
    .flatMap((row) => decodeMessageData(row.data).warnings);
  return mergeWarnings([warnings]);
}

export async function GET(): Promise<NextResponse<SubagentRootsRouteResponse>> {
  try {
    const connection = getConnection();
    if (!connection.ok) {
      if (connection.reason === "not-found") {
        return errorResponse("database_not_found", "No opencode database was found. Check the database location in Settings.", 404);
      }
      return errorResponse("schema_mismatch", "The opencode database schema is not supported by this version of oc-lens.", 409);
    }

    const roots = query<RootRow>(connection.db, `
      SELECT s.id
      FROM session s
      WHERE s.parent_id IS NULL
        AND EXISTS (SELECT 1 FROM session child WHERE child.parent_id = s.id)
      ORDER BY s.time_created, s.id
    `);
    const warnings = [];
    const trees: SubagentNode[] = [];
    for (const root of roots) {
      const result = subagentTree(connection.db, root.id);
      warnings.push(result.warnings);
      if (result.data !== null) trees.push(result.data);
    }
    const bySession = new Map(
      costBreakdown(connection.db, readPricing()).bySession.map((entry) => [entry.sessionId, entry.cost]),
    );

    return NextResponse.json({
      data: trees.map((tree) => applySessionCosts(tree, bySession)),
      meta: {
        generatedAt: Date.now(),
        schemaVersion,
        warnings: mergeWarnings([...warnings, pricingEvidenceWarnings(connection.db, trees)]),
      },
    });
  } catch {
    return errorResponse("subagent_roots_failed", "Subagent root sessions could not be read.", 500);
  }
}

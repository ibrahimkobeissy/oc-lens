import { NextResponse } from "next/server";
import { getConnection } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { getOverviewStats } from "@/lib/queries/projects";
import { costBreakdown } from "@/lib/pricing/breakdown";
import { readPricing } from "@/lib/pricing/config";
import { storedCostInRange } from "@/lib/pricing/cost";
import type { OcResponse, OverviewStats, StatsRouteResponse } from "@/types/oc";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
type RangeName = "7d" | "30d" | "90d" | "all";

function error(code: string, message: string, status: number): NextResponse<StatsRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

function validTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0); return true; } catch { return false; }
}

function rangeWindow(name: RangeName, now: number): { from?: number; to?: number } {
  if (name === "all") return {};
  return { from: now - Number.parseInt(name, 10) * DAY_MS, to: now + 1 };
}

function envelope(data: OverviewStats, warnings: ReturnType<typeof getOverviewStats>["warnings"]): OcResponse<OverviewStats> {
  return { data, meta: { generatedAt: Date.now(), schemaVersion, warnings } };
}

export async function GET(request: Request): Promise<NextResponse<StatsRouteResponse>> {
  const params = new URL(request.url).searchParams;
  const range = params.get("range") ?? "30d";
  const timeZone = params.get("tz") ?? "UTC";
  if (!(["7d", "30d", "90d", "all"] as string[]).includes(range)) return error("invalid_range", "range must be 7d, 30d, 90d, or all", 400);
  if (!validTimeZone(timeZone)) return error("invalid_timezone", "tz must be a valid IANA timezone", 400);
  try {
    const connection = getConnection();
    if (!connection.ok) {
      if (connection.reason === "not-found") return error("database_not_found", "No opencode database was found.", 404);
      return error("schema_mismatch", `Database schema does not match ${schemaVersion}.`, 409);
    }
    const now = Date.now();
    const window = rangeWindow(range as RangeName, now);
    const overview = getOverviewStats(connection.db, timeZone, now, window);
    const costs = costBreakdown(connection.db, readPricing(), timeZone, window);
    // costBreakdown's own storedCostComparison is intentionally all-time (code-review-2026-08-02.md M1) —
    // a ranged HTTP response must compare like with like, so scope it here, same as /api/costs.
    const rangedStoredCost = storedCostInRange(connection.db, window);
    const rangedCosts = { ...costs, storedCostComparison: rangedStoredCost };
    const modelCosts = new Map(costs.byModel.map((item) => [`${item.providerID}/${item.modelID}`, item.cost]));
    const projectCosts = new Map(costs.byProject.map((item) => [item.projectId, item.cost]));
    const data: OverviewStats = {
      ...overview.data,
      totalCost: costs.totalCost,
      storedCostComparison: rangedStoredCost,
      costBreakdown: rangedCosts,
      modelBreakdown: overview.data.modelBreakdown.map((item) => ({ ...item, cost: modelCosts.get(`${item.providerID}/${item.modelID}`) ?? { amount: 0, priced: false } })),
      projectBreakdown: overview.data.projectBreakdown.map((item) => ({ ...item, cost: projectCosts.get(item.id) ?? { amount: 0, priced: false } })),
    };
    return NextResponse.json(envelope(data, overview.warnings));
  } catch {
    return error("stats_failed", "Statistics could not be read from the opencode database.", 500);
  }
}

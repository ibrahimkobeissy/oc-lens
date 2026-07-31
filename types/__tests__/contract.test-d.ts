import { expectTypeOf } from "vitest";
import type {
  OcCost,
  OcEnvelope,
  OcErrorEnvelope,
  OcResponse,
  OcWarning,
  OverviewStats,
  SessionSummary,
  StatsRouteResponse,
} from "../oc";

// ─── Envelope generic ───────────────────────────────────────────────────────

expectTypeOf<OcEnvelope<SessionSummary[]>>().toHaveProperty("data").toEqualTypeOf<SessionSummary[]>();
expectTypeOf<OcEnvelope<SessionSummary[]>["meta"]>().toEqualTypeOf<{
  generatedAt: number;
  schemaVersion: string;
  warnings: OcWarning[];
}>();

// A route's named response type is exactly its envelope over its data shape.
expectTypeOf<StatsRouteResponse>().toEqualTypeOf<OcResponse<OverviewStats>>();
expectTypeOf<StatsRouteResponse>().toEqualTypeOf<OcEnvelope<OverviewStats> | OcErrorEnvelope>();

// ─── Money invariant: every cost field is { amount, priced }, never a bare number ──

expectTypeOf<OverviewStats["totalCost"]>().toEqualTypeOf<OcCost>();
expectTypeOf<OcCost>().toEqualTypeOf<{ amount: number; priced: boolean }>();
expectTypeOf<OverviewStats["totalCost"]>().not.toEqualTypeOf<number>();

// ─── Unknown-count invariant: a count affected by missing data carries a sibling unknownCount ──

expectTypeOf<OverviewStats>().toHaveProperty("unknownAgentCount").toEqualTypeOf<number>();
expectTypeOf<OverviewStats>().toHaveProperty("unknownModelCount").toEqualTypeOf<number>();

import type { OcCost, OcTokens } from "@/types/oc";

/** Shapes of `/api/audit/failures`, kept free of server imports so client components can use them. See lib/queries/failures.ts. */

export const FAILURE_KINDS = ["rate-limit", "provider-down", "auth", "invalid-request", "provider-error", "aborted", "unknown"] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export interface FailedCall {
  messageId: string;
  timeCreated: number;
  providerID: string | null;
  modelID: string | null;
  kind: FailureKind;
  rawType: string; // opencode's own label, verbatim: 2.x `error.type`, 1.x `error.name`
  status: number | null; // HTTP status when opencode recorded one
  message: string | null; // provider's error text, truncated; response headers/bodies are never read
  tokens: OcTokens | null; // usage opencode recorded on the failed step itself — normally none
}

export interface FailureIncident {
  sessionId: string;
  sessionTitle: string;
  firstFailureAt: number;
  failures: FailedCall[]; // every failed step until the session recovered (or ended)
  autoResends: number; // opencode's synthetic turns in between
  userResends: number; // the user's own messages in between
  providerFault: boolean; // false when every failure was the user cancelling
  recovery: { messageId: string; timeCreated: number; providerID: string | null; modelID: string | null; tokens: OcTokens; cost: OcCost } | null;
}

export interface FailuresReport {
  summary: {
    failedCalls: number;
    byKind: Record<FailureKind, number>;
    incidents: number;
    recovered: number;
    autoResends: number;
    userResends: number;
    resendTokens: OcTokens; // recovery-step usage, provider-fault incidents only
    resendCostAmount: number; // priced recovery steps only
    resendUnpriced: number; // recovery steps that could not be priced
    failedCallsWithUsage: number; // failed steps that nevertheless recorded tokens
    failedCallTokens: OcTokens;
  };
  byDay: Array<{ date: string; total: number } & Record<FailureKind, number>>;
  incidents: FailureIncident[]; // newest first
}

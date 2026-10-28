import type { OcCost, OcTokens } from "@/types/oc";

/** Shapes of `/api/audit/failures`, kept free of server imports so client components can use them. See lib/queries/failures.ts. */

export const FAILURE_KINDS = ["rate-limit", "provider-down", "transport", "auth", "invalid-request", "provider-error", "aborted", "unknown"] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export const FAILURE_KIND_LABELS: Record<FailureKind, string> = {
  "rate-limit": "Rate limit (TPM/RPM)",
  "provider-down": "Provider down (5xx)",
  transport: "Stream broke mid-response",
  auth: "Auth rejected",
  "invalid-request": "Invalid request",
  "provider-error": "Provider error",
  aborted: "Cancelled by you",
  unknown: "Unknown failure",
};

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
  retries: number | null; // retries opencode scheduled inside this step (`retry.attempt`), when it saved them
  accepted: boolean; // the provider answered HTTP 2xx: it took the request (and usually bills it) before the failure
  succeeded: boolean; // the step went on to succeed after its retries — the failures were hidden inside it
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
  resends: Array<{ messageId: string; by: "opencode" | "you" }>; // in order, between the first failure and the recovery
  /** The last successful step before the first failure — the baseline the recovery is compared with. */
  before: { messageId: string; tokens: OcTokens } | null;
  /**
   * Context the step before the failure read from cache but the recovery paid
   * at the full input price. Only computed when both steps used the same model.
   * Token *counts* barely change after a failure; this price shift is the cost.
   */
  cacheLost: { tokens: number; extraCost: OcCost } | null;
  /** Tool calls after the recovery that exactly repeat one made in the failed turn (tool + input hash, as loop detection matches). */
  repeatedCalls: Array<{ partId: string; messageId: string; tool: string; originalPartId: string }>;
  /**
   * Requests the provider accepted (HTTP 2xx) on which opencode recorded no
   * usage, and an estimate of the tokens they carried: each attempt resends the
   * context, sized from the step before. `tokens` is null when there is no
   * step before to size it from. An estimate: opencode records no usage for these requests.
   */
  acceptedUnrecorded: { requests: number; tokensPerRequest: number | null; tokens: number | null } | null;
}

/** What failures added to one session, beyond the usage it would have recorded anyway. */
export interface FailureOverhead {
  failedCalls: number;
  failedCallTokens: OcTokens; // usage recorded on failed calls: certain extra tokens (normally zero)
  cacheLostTokens: number;
  cacheLostExtraAmount: number; // priced cache losses only
  cacheLostUnpriced: number; // cache losses on models without a price
  repeatedCalls: number;
  hiddenRetries: number; // retries opencode made inside steps (saved `retry.attempt`), including steps that then succeeded
  acceptedUnrecordedRequests: number;
  acceptedUnrecordedTokens: number; // estimate
}

export interface SessionFailureReport {
  incidents: FailureIncident[]; // in session order
  overhead: FailureOverhead;
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
    cacheLostTokens: number;
    cacheLostExtraAmount: number;
    cacheLostUnpriced: number;
    repeatedCalls: number;
    hiddenRetries: number;
    acceptedUnrecordedRequests: number;
    acceptedUnrecordedTokens: number;
  };
  byDay: Array<{ date: string; total: number } & Record<FailureKind, number>>;
  incidents: FailureIncident[]; // newest first
}

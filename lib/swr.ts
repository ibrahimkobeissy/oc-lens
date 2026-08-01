import type { OcEnvelope, OcErrorBody } from "@/types/oc";
import type { SWRConfiguration } from "swr";

export const DEFAULT_POLL_INTERVAL_MS = 30_000;

/**
 * API route contract for data consumed through SWR.
 *
 * Every corresponding Next.js route must opt out of static rendering with
 * `export const dynamic = "force-dynamic"`. These responses reflect a live
 * SQLite file and must never be captured at build time. Route-owning tickets
 * add that export to their route modules; the client cannot enforce it.
 */
export const ocSWRConfig: SWRConfiguration = {
  refreshInterval: () =>
    typeof document !== "undefined" && document.visibilityState === "hidden"
      ? 0
      : DEFAULT_POLL_INTERVAL_MS,
  refreshWhenHidden: false,
  revalidateOnFocus: true,
  revalidateIfStale: true,
  shouldRetryOnError: (error: unknown) =>
    !(error instanceof OcApiError) || (!error.isDatabaseNotFound && !error.isSchemaMismatch),
};

export class OcApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(body: OcErrorBody, status: number) {
    super(body.message);
    this.name = "OcApiError";
    this.code = body.code;
    this.status = status;
  }

  get isDatabaseNotFound(): boolean {
    return this.code === "not_found" || this.code === "database_not_found";
  }

  get isSchemaMismatch(): boolean {
    return this.code === "schema_mismatch";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isErrorBody(value: unknown): value is OcErrorBody {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}

function isEnvelope<T>(value: unknown): value is OcEnvelope<T> {
  if (!isRecord(value) || !("data" in value) || !isRecord(value.meta)) {
    return false;
  }
  const meta = value.meta;
  return (
    typeof meta.generatedAt === "number" &&
    typeof meta.schemaVersion === "string" &&
    Array.isArray(meta.warnings)
  );
}

/** Fetches one JSON API envelope and turns typed API failures into OcApiError. */
export async function ocFetcher<T>(route: string): Promise<OcEnvelope<T>> {
  const response = await fetch(route, { headers: { accept: "application/json" } });
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new OcApiError(
      { code: "invalid_response", message: `The server returned a non-JSON response (${response.status}).` },
      response.status,
    );
  }

  if (isRecord(body) && isErrorBody(body.error)) {
    throw new OcApiError(body.error, response.status);
  }
  if (!response.ok || !isEnvelope<T>(body)) {
    throw new OcApiError(
      { code: "invalid_response", message: "The server returned an invalid oc-lens response envelope." },
      response.status,
    );
  }
  return body;
}

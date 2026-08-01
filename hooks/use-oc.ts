"use client";

import { ocFetcher, ocSWRConfig, type OcApiError } from "@/lib/swr";
import type {
  ActivityStats,
  AgentsResponse,
  CostBreakdown,
  ExportResponse,
  HealthResponse,
  OcEnvelope,
  OverviewStats,
  PricingSettingsResponse,
  ProjectDetail,
  ProjectSummary,
  SessionDetail,
  SessionListResponse,
  SessionReplay,
  SettingsResponse,
  SkillSummary,
  StorageBreakdown,
  TodosResponse,
  ToolsStats,
} from "@/types/oc";
import useSWR, { type SWRConfiguration, type SWRResponse } from "swr";

type Query = `?${string}`;
type StaticRoute =
  | "/api/stats"
  | "/api/activity"
  | "/api/sessions"
  | "/api/projects"
  | "/api/tools"
  | "/api/skills"
  | "/api/todos"
  | "/api/costs"
  | "/api/storage"
  | "/api/pricing"
  | "/api/settings"
  | "/api/health"
  | "/api/agents"
  | "/api/export";

/** Every OCL-010 API route, with arbitrary validated server-side query parameters. */
export type OcRoute =
  | StaticRoute
  | `${StaticRoute}${Query}`
  | `/api/sessions/${string}`
  | `/api/sessions/${string}${Query}`
  | `/api/sessions/${string}/replay`
  | `/api/sessions/${string}/replay${Query}`
  | `/api/projects/${string}`
  | `/api/projects/${string}${Query}`;

type WithoutQuery<R extends string> = R extends `${infer Path}?${string}` ? Path : R;

/** Resolves a route literal to its payload. Callers never supply this type manually. */
export type OcRouteData<R extends OcRoute> = WithoutQuery<R> extends "/api/stats"
  ? OverviewStats
  : WithoutQuery<R> extends "/api/activity"
    ? ActivityStats
    : WithoutQuery<R> extends "/api/sessions"
      ? SessionListResponse
      : WithoutQuery<R> extends `/api/sessions/${string}/replay`
        ? SessionReplay
        : WithoutQuery<R> extends `/api/sessions/${string}`
          ? SessionDetail
          : WithoutQuery<R> extends "/api/projects"
            ? ProjectSummary[]
            : WithoutQuery<R> extends `/api/projects/${string}`
              ? ProjectDetail
              : WithoutQuery<R> extends "/api/tools"
                ? ToolsStats
                : WithoutQuery<R> extends "/api/skills"
                  ? SkillSummary[]
                  : WithoutQuery<R> extends "/api/todos"
                    ? TodosResponse
                  : WithoutQuery<R> extends "/api/costs"
                    ? CostBreakdown
                    : WithoutQuery<R> extends "/api/storage"
                      ? StorageBreakdown
                      : WithoutQuery<R> extends "/api/pricing"
                        ? PricingSettingsResponse
                        : WithoutQuery<R> extends "/api/settings"
                          ? SettingsResponse
                      : WithoutQuery<R> extends "/api/health"
                        ? HealthResponse
                      : WithoutQuery<R> extends "/api/agents"
                        ? AgentsResponse
                      : WithoutQuery<R> extends "/api/export"
                            ? ExportResponse
                            : never;

export interface UseOcOptions
  extends Omit<
    SWRConfiguration,
    "fetcher" | "refreshInterval" | "refreshWhenHidden"
  > {
  /** Set false to pause both the initial request and polling. */
  enabled?: boolean;
  /** Poll interval in milliseconds; false disables polling. Defaults to 30 s. */
  polling?: number | false;
}

export type UseOcResult<R extends OcRoute> = SWRResponse<
  OcEnvelope<OcRouteData<R>>,
  OcApiError
>;

/** Fully typed SWR access to the OCL-010 route map. */
export function useOc<const R extends OcRoute>(
  route: R,
  options: UseOcOptions = {},
): UseOcResult<R> {
  const { enabled = true, polling, ...config } = options;
  const refreshInterval =
    polling === false
      ? 0
      : () =>
          typeof document !== "undefined" && document.visibilityState === "hidden"
            ? 0
            : (polling ?? 30_000);

  return useSWR<OcEnvelope<OcRouteData<R>>, OcApiError>(
    enabled ? route : null,
    ocFetcher<OcRouteData<R>>,
    {
      ...ocSWRConfig,
      ...config,
      refreshInterval,
      refreshWhenHidden: false,
    },
  );
}

"use client";

import { Suspense, useCallback } from "react";
import { MessagesSquare } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { SessionFilters, type SessionFilterValues } from "@/components/sessions/session-filters";
import { SessionTable, type SessionSort, type SortOrder } from "@/components/sessions/session-table";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Onboarding } from "@/components/states/onboarding";
import { SchemaMismatch } from "@/components/states/schema-mismatch";
import { TableSkeleton } from "@/components/states/table-skeleton";
import { WarningsBanner } from "@/components/states/warnings-banner";
import { useListKeyboardNavigation } from "@/hooks/use-global-keyboard-nav";
import { useOc } from "@/hooks/use-oc";
import { schemaVersion } from "@/lib/db/schema-guard";

const FILTER_KEYS = ["search", "project", "agent", "model", "from", "to", "archived", "hasError", "isSubagent"] as const;
const API_KEYS = [...FILTER_KEYS, "sort", "order", "limit", "cursor"] as const;
const SORTS = new Set<SessionSort>(["timeCreated", "timeUpdated", "timeArchived", "durationMs", "messages", "userMessages", "assistantMessages", "toolCallCount", "tokens", "inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens", "cost"]);

function localDateInput(epoch: string | null, inclusiveEnd = false): string {
  if (epoch === null || !/^\d+$/.test(epoch)) return "";
  const date = new Date(Number(epoch) - (inclusiveEnd ? 1 : 0));
  if (Number.isNaN(date.valueOf())) return "";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateInputEpoch(value: string, inclusiveEnd = false): string {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (inclusiveEnd) date.setDate(date.getDate() + 1);
  return `${date.getTime()}`;
}

export function apiRouteFromParams(params: URLSearchParams): `/api/sessions?${string}` {
  const api = new URLSearchParams();
  for (const key of API_KEYS) {
    const value = params.get(key);
    if (value !== null && value !== "") api.set(key, value);
  }
  if (!api.has("sort")) api.set("sort", "timeCreated");
  if (!api.has("order")) api.set("order", "desc");
  if (!api.has("limit")) api.set("limit", "25");
  return `/api/sessions?${api.toString()}`;
}

export function filterValuesFromParams(params: URLSearchParams): SessionFilterValues {
  return {
    search: params.get("search") ?? "",
    project: params.get("project") ?? "",
    agent: params.get("agent") ?? "",
    model: params.get("model") ?? "",
    from: localDateInput(params.get("from")),
    to: localDateInput(params.get("to"), true),
    archived: params.get("archived") ?? "",
    hasError: params.get("hasError") ?? "",
    isSubagent: params.get("isSubagent") ?? "",
  };
}

export function nextPageParams(source: URLSearchParams, nextCursor: string): URLSearchParams {
  const params = new URLSearchParams(source);
  params.append("trail", params.get("cursor") ?? "~");
  params.set("cursor", nextCursor);
  return params;
}

export function previousPageParams(source: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(source);
  const history = params.getAll("trail");
  const prior = history.pop();
  if (prior === undefined) return params;
  params.delete("trail");
  for (const item of history) params.append("trail", item);
  if (prior === "~") params.delete("cursor"); else params.set("cursor", prior);
  return params;
}

function SessionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = new URLSearchParams(searchParams.toString());
  const route = apiRouteFromParams(current);
  const { data, error, isLoading, mutate } = useOc(route);
  const trail = searchParams.getAll("trail");
  const requestedSort = searchParams.get("sort");
  const sort: SessionSort = requestedSort !== null && SORTS.has(requestedSort as SessionSort) ? requestedSort as SessionSort : "timeCreated";
  const order: SortOrder = searchParams.get("order") === "asc" ? "asc" : "desc";

  const navigate = useCallback((params: URLSearchParams) => {
    const query = params.toString();
    router.replace(query ? `/sessions?${query}` : "/sessions", { scroll: false });
  }, [router]);

  const changeFilter = useCallback((name: keyof SessionFilterValues, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const encoded = name === "from" ? dateInputEpoch(value) : name === "to" ? dateInputEpoch(value, true) : value.trim();
    if (encoded) params.set(name, encoded); else params.delete(name);
    params.delete("cursor");
    params.delete("trail");
    navigate(params);
  }, [navigate, searchParams]);

  const resetFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of FILTER_KEYS) params.delete(key);
    params.delete("cursor");
    params.delete("trail");
    navigate(params);
  }, [navigate, searchParams]);

  const sortBy = useCallback((nextSort: SessionSort) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", nextSort);
    params.set("order", sort === nextSort && order === "desc" ? "asc" : "desc");
    params.delete("cursor");
    params.delete("trail");
    navigate(params);
  }, [navigate, order, searchParams, sort]);

  const previous = useCallback(() => {
    navigate(previousPageParams(new URLSearchParams(searchParams.toString())));
  }, [navigate, searchParams]);

  const next = useCallback(() => {
    const nextCursor = data?.data.nextCursor;
    if (!nextCursor) return;
    navigate(nextPageParams(new URLSearchParams(searchParams.toString()), nextCursor));
  }, [data?.data.nextCursor, navigate, searchParams]);

  useListKeyboardNavigation({ onPrevious: trail.length > 0 ? previous : undefined, onNext: data?.data.nextCursor ? next : undefined });

  if (error?.isDatabaseNotFound) return <Onboarding />;
  if (error?.isSchemaMismatch) return <SchemaMismatch schemaVersion={schemaVersion} message={error.message} />;

  const hasFilters = FILTER_KEYS.some((key) => searchParams.has(key));
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <header><h1 className="text-2xl font-semibold text-foreground">Sessions</h1><p className="mt-1 text-sm text-muted-foreground">Explore opencode history without changing the source database.</p></header>
      <SessionFilters values={filterValuesFromParams(current)} onChange={changeFilter} onReset={resetFilters} />
      {isLoading && <TableSkeleton rows={10} columns={8} />}
      {error && !isLoading && <ErrorState title="Sessions could not be loaded" message={error.message} onRetry={() => void mutate()} />}
      {data && <WarningsBanner warnings={data.meta.warnings} />}
      {data && data.data.sessions.length === 0 && <EmptyState icon={<MessagesSquare />} title={hasFilters ? "No matching sessions" : "No sessions recorded"} description={hasFilters ? "Change or reset the filters to widen this view." : "Sessions will appear after opencode records activity."} />}
      {data && data.data.sessions.length > 0 && <SessionTable sessions={data.data.sessions} totalCount={data.data.totalCount} page={trail.length + 1} sort={sort} order={order} canPrevious={trail.length > 0} canNext={data.data.nextCursor !== null} onSort={sortBy} onPrevious={previous} onNext={next} />}
    </div>
  );
}

export default function SessionsPage() {
  return <Suspense fallback={<div className="p-4 sm:p-6"><TableSkeleton rows={10} columns={8} /></div>}><SessionsContent /></Suspense>;
}

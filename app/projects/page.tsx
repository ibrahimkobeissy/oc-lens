"use client";

import { useMemo, useState } from "react";
import { FolderKanban, Search } from "lucide-react";

import { ProjectCard } from "@/components/projects/project-card";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Onboarding } from "@/components/states/onboarding";
import { SchemaMismatch } from "@/components/states/schema-mismatch";
import { WarningsBanner } from "@/components/states/warnings-banner";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useOc } from "@/hooks/use-oc";
import { schemaVersion } from "@/lib/db/schema-guard";
import type { ProjectSummary } from "@/types/oc";

export type SortKey = "last-active" | "name" | "sessions" | "messages" | "tokens" | "cost";

const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: "last-active", label: "Last active" },
  { value: "name", label: "Name" },
  { value: "sessions", label: "Sessions" },
  { value: "messages", label: "Messages" },
  { value: "tokens", label: "Tokens" },
  { value: "cost", label: "Cost" },
];

function tokenTotal(project: ProjectSummary): number {
  return project.tokens.input
    + project.tokens.output
    + project.tokens.reasoning
    + project.tokens.cacheRead
    + project.tokens.cacheWrite;
}

function descendingNullable(left: number | null, right: number | null): number {
  if (left === null && right !== null) return 1;
  if (left !== null && right === null) return -1;
  if (left === null || right === null) return 0;
  return right - left;
}

function compareProjects(left: ProjectSummary, right: ProjectSummary, sort: SortKey): number {
  let compared = 0;
  if (sort === "name") compared = left.displayName.localeCompare(right.displayName);
  else if (sort === "sessions") compared = right.sessionCount - left.sessionCount;
  else if (sort === "messages") compared = right.messageCount - left.messageCount;
  else if (sort === "tokens") compared = tokenTotal(right) - tokenTotal(left);
  else if (sort === "last-active") compared = descendingNullable(left.lastActivity, right.lastActivity);
  else compared = descendingNullable(left.cost.priced ? left.cost.amount : null, right.cost.priced ? right.cost.amount : null);
  return compared || left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id);
}

export function filterAndSortProjects(
  projects: readonly ProjectSummary[],
  search: string,
  sort: SortKey,
): ProjectSummary[] {
  const term = search.trim().toLocaleLowerCase();
  return [...projects]
    .filter((project) => !term || [project.displayName, project.id, project.worktree]
      .some((value) => value.toLocaleLowerCase().includes(term)))
    .sort((left, right) => compareProjects(left, right, sort));
}

function ProjectGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading projects">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="space-y-5 rounded-xl border border-border bg-card p-5">
          <div className="flex gap-3"><Skeleton className="size-9" /><div className="flex-1 space-y-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-3 w-1/3" /></div></div>
          <Skeleton className="h-3 w-full" />
          <div className="grid grid-cols-2 gap-4"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
}

export default function ProjectsPage() {
  const { data, error, isLoading, mutate } = useOc("/api/projects");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("last-active");

  const projects = useMemo(() => {
    return filterAndSortProjects(data?.data ?? [], search, sort);
  }, [data, search, sort]);

  if (error?.isDatabaseNotFound) return <Onboarding />;
  if (error?.isSchemaMismatch) return <SchemaMismatch schemaVersion={schemaVersion} message={error.message} />;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="mt-1 text-sm text-muted-foreground">Session activity grouped by opencode project.</p>
      </div>

      {error && <ErrorState message={error.message} onRetry={() => void mutate()} />}
      {data && <WarningsBanner warnings={data.meta.warnings} />}

      {!error && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block w-full sm:max-w-sm">
            <span className="sr-only">Search projects</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, id, or worktree"
              className="pl-9"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="shrink-0">Sort by</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
      )}

      {isLoading && <ProjectGridSkeleton />}
      {!isLoading && !error && data?.data.length === 0 && (
        <EmptyState
          icon={<FolderKanban aria-hidden="true" className="size-6" />}
          title="No projects recorded"
          description="Projects will appear after opencode creates project history in the database."
        />
      )}
      {!isLoading && !error && data && data.data.length > 0 && projects.length === 0 && (
        <EmptyState title="No matching projects" description="Try a different project name, id, or worktree path." />
      )}
      {!isLoading && !error && projects.length > 0 && (
        <section aria-label="Projects" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => <ProjectCard key={project.id} project={project} />)}
        </section>
      )}
    </div>
  );
}

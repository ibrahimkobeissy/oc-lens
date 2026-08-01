"use client";

import { useMemo, useState } from "react";
import { Wrench } from "lucide-react";

import { ToolDurationTable } from "@/components/tools/tool-duration-table";
import { ToolRankingChart } from "@/components/tools/tool-ranking-chart";
import { SkillRankingChart } from "@/components/tools/skill-ranking-chart";
import { McpServerPanel } from "@/components/tools/mcp-server-panel";
import { ErrorCategoryChart } from "@/components/tools/error-category-chart";
import { ToolErrorPanel } from "@/components/tools/tool-error-panel";
import { FeatureAdoptionTable } from "@/components/tools/feature-adoption-table";
import { VersionHistoryTable } from "@/components/tools/version-history-table";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Onboarding } from "@/components/states/onboarding";
import { SchemaMismatch } from "@/components/states/schema-mismatch";
import { WarningsBanner } from "@/components/states/warnings-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { useOc } from "@/hooks/use-oc";
import { schemaVersion } from "@/lib/db/schema-guard";

type Range = "7d" | "30d" | "90d" | "all";

export default function ToolsPage() {
  const [range, setRange] = useState<Range>("30d");
  const route = useMemo(() => `/api/tools?range=${range}` as const, [range]);
  const skillsRoute = useMemo(() => `/api/skills?range=${range}` as const, [range]);
  const { data, error, isLoading, mutate } = useOc(route);
  const skills = useOc(skillsRoute);
  if (error?.isDatabaseNotFound) return <Onboarding />;
  if (error?.isSchemaMismatch) return <SchemaMismatch schemaVersion={schemaVersion} message={error.message} />;
  return <div className="space-y-6 p-4 sm:p-6">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-semibold">Tools</h1><p className="mt-1 text-sm text-muted-foreground">Rankings, categories, and latency from recorded opencode tool calls.</p></div><label className="text-sm font-medium">Range <select aria-label="Tools range" className="ml-2 h-9 rounded-md border border-input bg-background px-3" value={range} onChange={(event) => setRange(event.target.value as Range)}><option value="7d">7 days</option><option value="30d">30 days</option><option value="90d">90 days</option><option value="all">All time</option></select></label></header>
    {isLoading && <div className="space-y-4"><Skeleton className="h-96 rounded-lg" /><Skeleton className="h-72 rounded-lg" /></div>}
    {error && !isLoading && <ErrorState message={error.message} onRetry={() => void mutate()} />}
    {data && <WarningsBanner warnings={data.meta.warnings} />}
    {data && <>
      {data.data.tools.length === 0 && <EmptyState icon={<Wrench />} title="No tool calls in this range" description="Choose a wider range or run an opencode session that invokes tools." />}
      <ToolRankingChart tools={data.data.tools} />
      <ToolDurationTable tools={data.data.tools} />
      {skills.isLoading ? <Skeleton className="h-72 rounded-lg" /> : skills.error ? <ErrorState message="Skill analytics are temporarily unavailable." onRetry={() => void skills.mutate()} /> : <SkillRankingChart skills={skills.data?.data ?? []} />}
      <McpServerPanel servers={data.data.mcpServers} tools={data.data.tools} />
      <div className="grid gap-4 lg:grid-cols-2"><ErrorCategoryChart errors={data.data.errors} /><div className="lg:col-span-2"><ToolErrorPanel tools={data.data.tools} errors={data.data.errors} activity={data.data.activity} /></div></div>
      <FeatureAdoptionTable adoption={data.data.featureAdoption} />
      <VersionHistoryTable versions={data.data.versionHistory} />
    </>}
  </div>;
}

"use client";

import { Bot } from "lucide-react";

import { AgentActivityChart } from "@/components/agents/agent-activity-chart";
import { AgentBreakdownTable } from "@/components/agents/agent-breakdown-table";
import { AgentSwitchTimeline } from "@/components/agents/agent-switch-timeline";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Onboarding } from "@/components/states/onboarding";
import { SchemaMismatch } from "@/components/states/schema-mismatch";
import { TableSkeleton } from "@/components/states/table-skeleton";
import { WarningsBanner } from "@/components/states/warnings-banner";
import { useOc } from "@/hooks/use-oc";
import { schemaVersion } from "@/lib/db/schema-guard";

export default function AgentsPage() {
  const { data, error, isLoading, mutate } = useOc("/api/agents", { polling: false });
  const hasData = Boolean(data && (data.data.agents.length > 0 || data.data.activity.length > 0 || data.data.switches.length > 0));

  if (error?.isDatabaseNotFound) return <Onboarding />;
  if (error?.isSchemaMismatch) return <SchemaMismatch schemaVersion={schemaVersion} message={error.message} />;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Bot aria-hidden="true" className="size-6" />Agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">Usage, tools, errors, and recorded agent transitions across local history.</p>
      </div>
      {error ? <ErrorState message={error.message} onRetry={() => void mutate()} /> : null}
      {data ? <WarningsBanner warnings={data.meta.warnings} /> : null}
      {isLoading ? <TableSkeleton rows={6} columns={8} /> : null}
      {!isLoading && !error && data && !hasData ? (
        <EmptyState icon={<Bot aria-hidden="true" />} title="No agent activity recorded" description="Agents will appear after opencode records sessions or messages with agent evidence." />
      ) : null}
      {!isLoading && !error && data && hasData ? (
        <>
          {data.data.agents.length > 0 ? <AgentBreakdownTable agents={data.data.agents} /> : null}
          <AgentActivityChart points={data.data.activity} />
          <AgentSwitchTimeline events={data.data.switches} />
        </>
      ) : null}
    </div>
  );
}

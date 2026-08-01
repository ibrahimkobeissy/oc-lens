"use client";

import { GitBranch } from "lucide-react";

import { SubagentTree } from "@/components/sessions/subagent-tree";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Onboarding } from "@/components/states/onboarding";
import { SchemaMismatch } from "@/components/states/schema-mismatch";
import { WarningsBanner } from "@/components/states/warnings-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { useOc } from "@/hooks/use-oc";
import { schemaVersion } from "@/lib/db/schema-guard";

export default function SubagentTreesPage() {
  const trees = useOc("/api/sessions/tree", { polling: false });

  if (trees.isLoading || (!trees.data && !trees.error)) {
    return <div className="space-y-5 p-4 sm:p-6" role="status" aria-label="Loading subagent trees"><Skeleton className="h-20 rounded-lg" /><Skeleton className="h-80 rounded-lg" /></div>;
  }
  if (trees.error?.isDatabaseNotFound) return <Onboarding />;
  if (trees.error?.isSchemaMismatch) return <SchemaMismatch schemaVersion={schemaVersion} message={trees.error.message} />;
  if (trees.error) return <div className="p-4 sm:p-6"><ErrorState message={trees.error.message} onRetry={() => void trees.mutate()} /></div>;
  if (!trees.data) return null;

  return (
    <div className="min-w-0 space-y-6 p-4 sm:p-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Delegation analytics</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Subagent trees</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every root session that spawned recorded child sessions, loaded without pagination.</p>
      </header>
      <WarningsBanner warnings={trees.data.meta.warnings} />
      {trees.data.data.length === 0 ? (
        <EmptyState icon={<GitBranch aria-hidden="true" />} title="No subagent trees" description="Root sessions appear here after opencode records a child session with parent_id." />
      ) : (
        <div className="space-y-6">
          {trees.data.data.map((tree) => <SubagentTree key={tree.sessionId} node={tree} />)}
        </div>
      )}
    </div>
  );
}

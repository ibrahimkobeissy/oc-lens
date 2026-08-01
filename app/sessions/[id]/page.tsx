"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Archive, Bot, CalendarDays, FolderKanban, MessageSquare, Wrench } from "lucide-react";

import { WindowedTurnStream } from "@/components/sessions/replay/turn-cards";
import { SubagentTree } from "@/components/sessions/subagent-tree";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Onboarding } from "@/components/states/onboarding";
import { SchemaMismatch } from "@/components/states/schema-mismatch";
import { WarningsBanner } from "@/components/states/warnings-banner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOc } from "@/hooks/use-oc";
import { schemaVersion } from "@/lib/db/schema-guard";
import { formatDuration, formatNumber } from "@/lib/format";

function LoadingReplay() {
  return <div className="space-y-5 p-4 sm:p-6" aria-label="Loading session replay" role="status"><Skeleton className="h-24 rounded-lg" /><div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-20 rounded-lg" /><Skeleton className="h-20 rounded-lg" /><Skeleton className="h-20 rounded-lg" /></div><Skeleton className="h-[32rem] rounded-lg" /></div>;
}

export default function SessionReplayPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = params.id;
  const route = `/api/sessions/${encodeURIComponent(id)}/replay` as const;
  const treeRoute = `/api/sessions/${encodeURIComponent(id)}/tree` as const;
  const replay = useOc(route, { polling: false });
  const tree = useOc(treeRoute, { enabled: (replay.data?.data.childIds.length ?? 0) > 0, polling: false });

  if (replay.isLoading || (!replay.data && !replay.error)) return <LoadingReplay />;
  if (replay.error?.isDatabaseNotFound) return <Onboarding />;
  if (replay.error?.isSchemaMismatch) return <SchemaMismatch schemaVersion={schemaVersion} message={replay.error.message} />;
  if (replay.error) return <div className="p-4 sm:p-6"><ErrorState message={replay.error.message} onRetry={() => void replay.mutate()} /></div>;
  if (!replay.data) return <LoadingReplay />;

  const data = replay.data.data;
  const session = data.session;
  const model = session.model ? `${session.model.providerID}/${session.model.id}${session.model.variant ? ` · ${session.model.variant}` : ""}` : "unknown model";
  return <div className="space-y-5 p-4 sm:p-6">
    <header className="space-y-3"><div><p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Session replay</p><h1 className="mt-1 break-words text-2xl font-semibold tracking-tight">{session.title}</h1></div><div className="flex flex-wrap gap-2"><Badge variant="outline"><FolderKanban />{session.projectDisplayName}</Badge><Badge variant="outline"><Bot />{session.agent ?? "unknown agent"}</Badge><Badge variant="outline">{model}</Badge><Badge variant="outline">v{session.version}</Badge>{session.timeArchived !== null ? <Badge variant="secondary"><Archive />Archived</Badge> : null}</div></header>
    <WarningsBanner warnings={replay.data.meta.warnings} />
    {tree.data ? <WarningsBanner warnings={tree.data.meta.warnings} /> : null}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card><CardContent><p className="flex items-center gap-2 text-xs text-muted-foreground"><MessageSquare className="size-4" />Turns</p><p className="mt-2 font-mono text-2xl font-semibold">{formatNumber(data.turns.length)}</p></CardContent></Card>
      <Card><CardContent><p className="flex items-center gap-2 text-xs text-muted-foreground"><Wrench className="size-4" />Tool calls</p><p className="mt-2 font-mono text-2xl font-semibold">{formatNumber(session.toolCallCount)}</p></CardContent></Card>
      <Card><CardContent><p className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarDays className="size-4" />Started</p><p suppressHydrationWarning className="mt-2 text-sm font-medium">{new Date(session.timeCreated).toLocaleString()}</p></CardContent></Card>
      <Card><CardContent><p className="text-xs text-muted-foreground">Session duration</p><p className="mt-2 font-mono text-2xl font-semibold">{formatDuration(session.durationMs)}</p></CardContent></Card>
    </div>
    {tree.isLoading ? <Skeleton className="h-80 rounded-lg" /> : null}
    {tree.error ? <ErrorState title="Subagent tree could not be loaded" message={tree.error.message} onRetry={() => void tree.mutate()} /> : null}
    {tree.data ? <SubagentTree node={tree.data.data} /> : null}
    {data.turns.length === 0 ? <EmptyState title="No replay turns" description="This session has no recorded messages to replay." /> : <WindowedTurnStream turns={data.turns} targetPartId={searchParams.get("part")} />}
  </div>;
}

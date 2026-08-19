"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Archive, Bot, CalendarDays, FolderKanban, MessageSquare, Wrench } from "lucide-react";

import { FileTimeline } from "@/components/sessions/file-timeline";
import { SessionLoops } from "@/components/sessions/replay/session-loops";
import { SessionSidebar } from "@/components/sessions/replay/session-sidebar";
import { TokenAccumulationChart } from "@/components/sessions/replay/token-accumulation-chart";
import { WindowedTurnStream, replayTurnIndexForPart, type LoopPartMark, type WindowedTurnStreamHandle } from "@/components/sessions/replay/turn-cards";
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
import { DEFAULT_UI_MIN_REPEATS } from "@/lib/loops";
import { formatDuration, formatNumber } from "@/lib/format";
import type { OcWarning } from "@/types/oc";

/**
 * Replay, tree, and file envelopes overlap in the rows they decode. Preserve
 * the first message from the broadest scope (replay, then tree, then files)
 * and the maximum observed count for each code; summing would double-count
 * the same underlying evidence.
 */
export function dedupeReplayWarnings(...scopes: ReadonlyArray<readonly OcWarning[]>): OcWarning[] {
  const byCode = new Map<string, OcWarning>();
  for (const warnings of scopes) {
    for (const warning of warnings) {
      const existing = byCode.get(warning.code);
      if (!existing) byCode.set(warning.code, { ...warning });
      else if (warning.count > existing.count) byCode.set(warning.code, { ...existing, count: warning.count });
    }
  }
  return [...byCode.values()].sort((left, right) => left.code.localeCompare(right.code));
}

function LoadingReplay() {
  return <div className="space-y-5 p-4 sm:p-6" aria-label="Loading session replay" role="status"><Skeleton className="h-24 rounded-lg" /><div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-20 rounded-lg" /><Skeleton className="h-20 rounded-lg" /><Skeleton className="h-20 rounded-lg" /></div><Skeleton className="h-[32rem] rounded-lg" /></div>;
}

export default function SessionReplayPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = params.id;
  const route = `/api/sessions/${encodeURIComponent(id)}/replay` as const;
  const treeRoute = `/api/sessions/${encodeURIComponent(id)}/tree` as const;
  const filesRoute = `/api/sessions/${encodeURIComponent(id)}/files` as const;
  // Defaults to the detector's own threshold. Marking bare pairs by default was
  // tried and reverted — it lit up whole groups of unrelated reads — but the
  // control stays here so the pair-level view is one click away rather than gone.
  const [minRepeats, setMinRepeats] = useState<number>(DEFAULT_UI_MIN_REPEATS);
  const loopsRoute = `/api/loops?sessionId=${encodeURIComponent(id)}&minRepeats=${minRepeats}` as const;
  const replay = useOc(route, { polling: false });
  const tree = useOc(treeRoute, { enabled: (replay.data?.data.childIds.length ?? 0) > 0, polling: false });
  const files = useOc(filesRoute, { enabled: replay.data !== undefined && replay.error === undefined, polling: false });
  const loops = useOc(loopsRoute, { enabled: replay.data !== undefined && replay.error === undefined, polling: false });
  const turnStreamRef = useRef<WindowedTurnStreamHandle>(null);
  const jumpToTurn = useCallback((index: number) => turnStreamRef.current?.scrollToTurn(index), []);
  // A jump from the loop panel retargets the stream, so the part is highlighted
  // and focused exactly as an incoming `?part=` deep link would.
  const [loopTargetPartId, setLoopTargetPartId] = useState<string | null>(null);
  const turns = replay.data?.data.turns;
  const jumpToPart = useCallback((partId: string) => {
    setLoopTargetPartId(partId);
    const index = turns === undefined ? -1 : replayTurnIndexForPart(turns, partId);
    if (index >= 0) turnStreamRef.current?.scrollToTurn(index);
  }, [turns]);
  // Only the repeated calls themselves are marked, each knowing which repeat it
  // is — banding a whole turn implied its unrelated calls were loops too.
  const loopParts = useMemo(() => {
    const marks = new Map<string, LoopPartMark>();
    for (const incident of loops.data?.data.incidents ?? []) {
      incident.partIds.forEach((partId, index) => {
        marks.set(partId, { position: index + 1, total: incident.partIds.length, partIds: incident.partIds });
      });
    }
    return marks;
  }, [loops.data]);

  if (replay.isLoading || (!replay.data && !replay.error)) return <LoadingReplay />;
  if (replay.error?.isDatabaseNotFound) return <Onboarding />;
  if (replay.error?.isSchemaMismatch) return <SchemaMismatch schemaVersion={schemaVersion} message={replay.error.message} />;
  if (replay.error) return <div className="p-4 sm:p-6"><ErrorState message={replay.error.message} onRetry={() => void replay.mutate()} /></div>;
  if (!replay.data) return <LoadingReplay />;

  const data = replay.data.data;
  const session = data.session;
  const model = session.model ? `${session.model.providerID}/${session.model.id}${session.model.variant ? ` · ${session.model.variant}` : ""}` : "unknown model";
  const warnings = dedupeReplayWarnings(replay.data.meta.warnings, tree.data?.meta.warnings ?? [], files.data?.meta.warnings ?? []);
  return <div className="space-y-5 p-4 sm:p-6">
    <header className="space-y-3"><div><p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Session replay</p><h1 className="mt-1 break-words text-2xl font-semibold tracking-tight">{session.title}</h1></div><div className="flex flex-wrap gap-2"><Badge variant="outline"><FolderKanban />{session.projectDisplayName}</Badge><Badge variant="outline"><Bot />{session.agent ?? "unknown agent"}</Badge><Badge variant="outline">{model}</Badge><Badge variant="outline">v{session.version}</Badge>{session.timeArchived !== null ? <Badge variant="secondary"><Archive />Archived</Badge> : null}</div></header>
    <WarningsBanner warnings={warnings} />
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card><CardContent><p className="flex items-center gap-2 text-xs text-muted-foreground"><MessageSquare className="size-4" />Turns</p><p className="mt-2 font-mono text-2xl font-semibold">{formatNumber(data.turns.length)}</p></CardContent></Card>
      <Card><CardContent><p className="flex items-center gap-2 text-xs text-muted-foreground"><Wrench className="size-4" />Tool calls</p><p className="mt-2 font-mono text-2xl font-semibold">{formatNumber(session.toolCallCount)}</p></CardContent></Card>
      <Card><CardContent><p className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarDays className="size-4" />Started</p><p suppressHydrationWarning className="mt-2 text-sm font-medium">{new Date(session.timeCreated).toLocaleString()}</p></CardContent></Card>
      <Card><CardContent><p className="text-xs text-muted-foreground">Session duration</p><p className="mt-2 font-mono text-2xl font-semibold">{formatDuration(session.durationMs)}</p></CardContent></Card>
    </div>
    {tree.isLoading ? <Skeleton className="h-80 rounded-lg" /> : null}
    {tree.error ? <ErrorState title="Subagent tree could not be loaded" message={tree.error.message} onRetry={() => void tree.mutate()} /> : null}
    {tree.data ? <SubagentTree node={tree.data.data} /> : null}
    {files.isLoading ? <div role="status" aria-label="Loading file timeline"><Skeleton className="h-48 rounded-lg" /></div> : null}
    {files.error ? <ErrorState title="File timeline could not be loaded" message={files.error.message} onRetry={() => void files.mutate()} /> : null}
    {files.data ? <FileTimeline changes={files.data.data.changes} projectWorktree={files.data.data.projectWorktree} /> : null}
    {loops.data ? <SessionLoops analysis={loops.data.data} onJumpToPart={jumpToPart} minRepeats={minRepeats} onMinRepeatsChange={setMinRepeats} /> : null}
    <TokenAccumulationChart replay={data} />
    {data.turns.length === 0 ? <EmptyState title="No replay turns" description="This session has no recorded messages to replay." /> : <div className="flex min-w-0 flex-col gap-4 lg:flex-row"><SessionSidebar replay={data} onTurnJump={jumpToTurn} /><div className="min-w-0 flex-1"><WindowedTurnStream ref={turnStreamRef} turns={data.turns} targetPartId={loopTargetPartId ?? searchParams.get("part")} loopParts={loopParts} onJumpToPart={jumpToPart} /></div></div>}
  </div>;
}

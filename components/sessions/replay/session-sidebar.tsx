"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertOctagon, Bot, Hourglass, List, MessagesSquare, RefreshCw, Repeat2, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { formatDuration, formatNumber, formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReplayTurn, SessionReplay } from "@/types/oc";
import type { ReplayFailureMarks } from "./failure-marks";
import type { LoopPartMark } from "./tool-group";

export interface VisibleTurnEvidence {
  index: number;
  intersectionRatio: number;
  top: number;
}

export function mostVisibleTurn(entries: readonly VisibleTurnEvidence[]): number | null {
  const visible = entries.filter((entry) => entry.intersectionRatio > 0);
  return visible.sort((left, right) => right.intersectionRatio - left.intersectionRatio || Math.abs(left.top) - Math.abs(right.top) || left.index - right.index)[0]?.index ?? null;
}

export function scrollMountedReplayTurn(messageId: string, root: ParentNode = document): boolean {
  const element = [...root.querySelectorAll<HTMLElement>("[data-message-id]")].find((candidate) => candidate.dataset.messageId === messageId);
  if (!element) return false;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}

export function jumpToReplayTurn(turn: Pick<ReplayTurn, "messageId">, index: number, onTurnJump: (turnIndex: number) => void, root: ParentNode = document): boolean {
  onTurnJump(index);
  return scrollMountedReplayTurn(turn.messageId, root);
}

/** `number` is the turn's position in the session, which differs from its list index when the list runs newest first. */
function turnLabel(turn: ReplayTurn, number: number): string {
  const event = turn.parts.find((part) => part.data.type === "session-event");
  if (event?.data.type === "session-event") return `${number}. ${event.data.summary.slice(0, 64)}`;
  const text = turn.parts.find((part) => part.data.type === "text");
  const preview = text?.data.type === "text" ? text.data.text.trim().replace(/\s+/g, " ") : "";
  return preview ? `${number}. ${preview.slice(0, 64)}` : `${number}. ${turn.role === "unknown" ? "unknown role" : turn.role}`;
}

export interface TurnFlags {
  toolCalls: number;
  error: boolean; // a failed provider call, or a tool call that errored
  loop: boolean; // a repeated call: a loop, or a call redone after a failure
  slowStart: boolean;
  resend: boolean;
}

/** What a turn-index entry shows next to its label. Pure, so it is cheap for hundreds of turns. */
export function turnFlags(turn: ReplayTurn, loopParts?: ReadonlyMap<string, LoopPartMark>, failureMarks?: ReplayFailureMarks): TurnFlags {
  let toolCalls = 0;
  let toolError = false;
  let loop = false;
  for (const part of turn.parts) {
    if (part.data.type === "tool") {
      toolCalls += 1;
      if (part.data.status === "error") toolError = true;
    }
    if (loopParts?.has(part.id) || failureMarks?.repeatedParts.has(part.id)) loop = true;
  }
  const mark = failureMarks?.turns.get(turn.messageId);
  return {
    toolCalls,
    error: toolError || mark?.type === "failed",
    loop,
    slowStart: failureMarks?.slowStarts.has(turn.messageId) ?? false,
    resend: mark?.type === "resend",
  };
}

function FlagIcons({ flags }: { flags: TurnFlags }) {
  return <span className="flex shrink-0 items-center gap-1">
    {flags.error ? <AlertOctagon role="img" aria-label="Error" className="size-3.5 text-destructive"><title>Error: a failed call or an errored tool</title></AlertOctagon> : null}
    {flags.loop ? <Repeat2 role="img" aria-label="Repeated call" className="size-3.5 text-warning"><title>Repeated call (loop, or redone after a failure)</title></Repeat2> : null}
    {flags.slowStart ? <Hourglass role="img" aria-label="Slow start" className="size-3.5 text-warning"><title>Slow start: possible hidden retries or a slow provider</title></Hourglass> : null}
    {flags.resend ? <RefreshCw role="img" aria-label="Resend" className="size-3.5 text-warning"><title>Resend after a failed call</title></RefreshCw> : null}
    {flags.toolCalls > 0 ? <Wrench role="img" aria-label={`${flags.toolCalls} tool call${flags.toolCalls === 1 ? "" : "s"}`} className="size-3.5 text-muted-foreground/70"><title>{`${flags.toolCalls} tool call${flags.toolCalls === 1 ? "" : "s"}`}</title></Wrench> : null}
  </span>;
}

function useReplayScrollSpy(turns: readonly ReplayTurn[]): [number, (index: number) => void] {
  const [active, setActive] = useState(0);
  const indexByMessage = useMemo(() => new Map(turns.map((turn, index) => [turn.messageId, index])), [turns]);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[role="feed"][aria-label="Ordered replay turns"]');
    if (!root || typeof IntersectionObserver === "undefined") return;
    const ratios = new Map<Element, VisibleTurnEvidence>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const messageId = (entry.target as HTMLElement).dataset.messageId;
        const index = messageId ? indexByMessage.get(messageId) : undefined;
        if (index === undefined) continue;
        ratios.set(entry.target, { index, intersectionRatio: entry.isIntersecting ? entry.intersectionRatio : 0, top: entry.boundingClientRect.top - root.getBoundingClientRect().top });
      }
      const next = mostVisibleTurn([...ratios.values()]);
      if (next !== null) setActive(next);
    }, { root, threshold: [0, 0.25, 0.5, 0.75, 1] });
    const observed = new Set<Element>();
    const observeTurns = () => {
      for (const element of root.querySelectorAll("[data-message-id]")) {
        if (!observed.has(element)) { observed.add(element); observer.observe(element); }
      }
      for (const element of observed) {
        if (!root.contains(element)) { observer.unobserve(element); observed.delete(element); ratios.delete(element); }
      }
    };
    observeTurns();
    const mutations = new MutationObserver(observeTurns);
    mutations.observe(root, { childList: true, subtree: true });
    return () => { mutations.disconnect(); observer.disconnect(); };
  }, [indexByMessage]);

  return [active, setActive];
}

interface SidebarContentsProps {
  replay: SessionReplay;
  activeTurnIndex: number;
  onSelect: (index: number) => void;
  newestFirst: boolean;
  loopParts?: ReadonlyMap<string, LoopPartMark>;
  failureMarks?: ReplayFailureMarks;
}

function SidebarContents({ replay, activeTurnIndex, onSelect, newestFirst, loopParts, failureMarks }: SidebarContentsProps) {
  const session = replay.session;
  const totalTokens = session.tokens.input + session.tokens.output + session.tokens.reasoning + session.tokens.cacheRead + session.tokens.cacheWrite;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-xs">
        <p className="break-words font-medium text-foreground">{session.title}</p>
        <div className="flex flex-wrap gap-1.5"><Badge variant="outline"><Bot aria-hidden="true" />{session.agent ?? "unknown agent"}</Badge><Badge variant="outline">{session.model ? `${session.model.providerID}/${session.model.id}` : "unknown model"}</Badge></div>
        <dl className="grid grid-cols-2 gap-2 text-muted-foreground"><div><dt>Turns</dt><dd className="font-mono text-foreground">{formatNumber(replay.turns.length)}</dd></div><div><dt>Duration</dt><dd className="font-mono text-foreground">{formatDuration(session.durationMs)}</dd></div><div><dt>Tokens</dt><dd className="font-mono text-foreground">{formatTokens(totalTokens)}</dd></div><div><dt>Project</dt><dd className="truncate text-foreground" title={session.projectDisplayName}>{session.projectDisplayName}</dd></div></dl>
      </div>
      <nav aria-label="Replay turn index" className="min-h-0 flex-1 overflow-y-auto">
        {replay.turns.length === 0 ? <p className="text-xs text-muted-foreground">No turns to index.</p> : (
          <ol className="space-y-1">
            {replay.turns.map((turn, index) => <li key={turn.messageId}><button type="button" aria-current={activeTurnIndex === index ? "step" : undefined} onClick={() => onSelect(index)} className={cn("flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors", activeTurnIndex === index ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")} title={turnLabel(turn, newestFirst ? replay.turns.length - index : index + 1)}><span className="min-w-0 flex-1 truncate">{turnLabel(turn, newestFirst ? replay.turns.length - index : index + 1)}</span><FlagIcons flags={turnFlags(turn, loopParts, failureMarks)} /></button></li>)}
          </ol>
        )}
      </nav>
    </div>
  );
}

export function SessionSidebar({ replay, onTurnJump, newestFirst = false, loopParts, failureMarks }: { replay: SessionReplay; onTurnJump: (turnIndex: number) => void; newestFirst?: boolean; loopParts?: ReadonlyMap<string, LoopPartMark>; failureMarks?: ReplayFailureMarks }) {
  const [activeTurnIndex, setActiveTurnIndex] = useReplayScrollSpy(replay.turns);
  const [sheetOpen, setSheetOpen] = useState(false);
  const selectTurn = (index: number) => {
    const turn = replay.turns[index];
    if (!turn) return;
    setActiveTurnIndex(index);
    jumpToReplayTurn(turn, index, onTurnJump);
    setSheetOpen(false);
  };
  return (
    <>
      <aside aria-label="Session replay sidebar" className="sticky top-20 hidden h-[calc(100vh-15rem)] min-h-[32rem] w-72 shrink-0 lg:flex lg:flex-col">
        <SidebarContents replay={replay} activeTurnIndex={activeTurnIndex} onSelect={selectTurn} newestFirst={newestFirst} loopParts={loopParts} failureMarks={failureMarks} />
      </aside>
      <div className="lg:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild><Button type="button" variant="outline" className="w-full"><List aria-hidden="true" />Session details and turn index</Button></SheetTrigger>
          <SheetContent side="right" className="w-[min(92vw,24rem)] sm:max-w-sm">
            <SheetHeader><SheetTitle className="flex items-center gap-2"><MessagesSquare aria-hidden="true" />Session replay</SheetTitle><SheetDescription>Metadata and ordered turn navigation.</SheetDescription></SheetHeader>
            <div className="min-h-0 flex-1 overflow-hidden px-4 pb-4"><SidebarContents replay={replay} activeTurnIndex={activeTurnIndex} onSelect={selectTurn} newestFirst={newestFirst} loopParts={loopParts} failureMarks={failureMarks} /></div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

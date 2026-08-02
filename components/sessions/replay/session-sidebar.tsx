"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, List, MessagesSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { formatDuration, formatNumber, formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReplayTurn, SessionReplay } from "@/types/oc";

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

function turnLabel(turn: ReplayTurn, index: number): string {
  const text = turn.parts.find((part) => part.data.type === "text");
  const preview = text?.data.type === "text" ? text.data.text.trim().replace(/\s+/g, " ") : "";
  return preview ? `${index + 1}. ${preview.slice(0, 64)}` : `${index + 1}. ${turn.role === "unknown" ? "unknown role" : turn.role}`;
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
}

function SidebarContents({ replay, activeTurnIndex, onSelect }: SidebarContentsProps) {
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
            {replay.turns.map((turn, index) => <li key={turn.messageId}><button type="button" aria-current={activeTurnIndex === index ? "step" : undefined} onClick={() => onSelect(index)} className={cn("block w-full truncate rounded-md px-2 py-1.5 text-left text-xs transition-colors", activeTurnIndex === index ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")} title={turnLabel(turn, index)}>{turnLabel(turn, index)}</button></li>)}
          </ol>
        )}
      </nav>
    </div>
  );
}

export function SessionSidebar({ replay, onTurnJump }: { replay: SessionReplay; onTurnJump: (turnIndex: number) => void }) {
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
        <SidebarContents replay={replay} activeTurnIndex={activeTurnIndex} onSelect={selectTurn} />
      </aside>
      <div className="lg:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild><Button type="button" variant="outline" className="w-full"><List aria-hidden="true" />Session details and turn index</Button></SheetTrigger>
          <SheetContent side="right" className="w-[min(92vw,24rem)] sm:max-w-sm">
            <SheetHeader><SheetTitle className="flex items-center gap-2"><MessagesSquare aria-hidden="true" />Session replay</SheetTitle><SheetDescription>Metadata and ordered turn navigation.</SheetDescription></SheetHeader>
            <div className="min-h-0 flex-1 overflow-hidden px-4 pb-4"><SidebarContents replay={replay} activeTurnIndex={activeTurnIndex} onSelect={selectTurn} /></div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

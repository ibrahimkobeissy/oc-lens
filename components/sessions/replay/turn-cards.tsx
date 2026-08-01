"use client";

import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Bot, Clock, UserRound } from "lucide-react";

import { AssistantMarkdown } from "./assistant-markdown";
import { partDomId, registerReplayPartRenderer, replayPartRenderer, type ReplayPartRendererProps } from "./part-registry";
import { Badge } from "@/components/ui/badge";
import { formatDuration, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OcTokens, ReplayTurn } from "@/types/oc";

function TextPart({ part, turn }: ReplayPartRendererProps) {
  if (part.data.type !== "text") return null;
  return turn.role === "assistant"
    ? <AssistantMarkdown content={part.data.text} />
    : <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{part.data.text}</p>;
}

registerReplayPartRenderer("text", TextPart);

function tokenTotal(tokens: OcTokens | null): number | null {
  return tokens === null ? null : tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite;
}

function PartList({ turn }: { turn: ReplayTurn }) {
  return <div className="space-y-3">{turn.parts.map((part) => {
    const Renderer = replayPartRenderer(part.data.type);
    return <div key={part.id} id={partDomId(part.id)} data-part-id={part.id} tabIndex={-1} className="scroll-mt-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Renderer part={part} turn={turn} /></div>;
  })}</div>;
}

function TurnMeta({ turn }: { turn: ReplayTurn }) {
  const total = tokenTotal(turn.tokens);
  return <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
    <time suppressHydrationWarning dateTime={new Date(turn.timeCreated).toISOString()}>{new Date(turn.timeCreated).toLocaleString()}</time>
    {turn.agent ? <Badge variant="outline">{turn.agent}</Badge> : <Badge variant="outline">unknown agent</Badge>}
    {turn.durationMs === null ? null : <span className="inline-flex items-center gap-1"><Clock aria-hidden="true" className="size-3" />{formatDuration(turn.durationMs)}</span>}
    {total === null ? null : <span className="font-mono tabular-nums">{formatNumber(total)} tokens</span>}
  </div>;
}

interface TurnCardProps {
  turn: ReplayTurn;
  position?: number;
  setSize?: number;
}

export function UserTurnCard({ turn, position, setSize }: TurnCardProps) {
  return <article aria-label="User turn" aria-posinset={position} aria-setsize={setSize} data-message-id={turn.messageId} className="ml-auto max-w-3xl rounded-xl border border-primary/25 bg-primary/5 p-4"><header className="mb-3 flex items-start justify-between gap-3"><div className="flex items-center gap-2 font-medium"><UserRound aria-hidden="true" className="size-4 text-primary" />User</div><TurnMeta turn={turn} /></header><PartList turn={turn} /></article>;
}

export function AssistantTurnCard({ turn, position, setSize }: TurnCardProps) {
  const unknown = turn.role === "unknown";
  return <article aria-label={unknown ? "Unknown-role turn" : "Assistant turn"} aria-posinset={position} aria-setsize={setSize} data-message-id={turn.messageId} className={cn("mr-auto max-w-4xl rounded-xl border bg-card p-4", unknown && "border-dashed")}><header className="mb-3 flex items-start justify-between gap-3"><div className="flex items-center gap-2 font-medium"><Bot aria-hidden="true" className="size-4 text-primary" />{unknown ? "Unknown role" : "Assistant"}</div><TurnMeta turn={turn} /></header><PartList turn={turn} /></article>;
}

export function TurnCard(props: TurnCardProps) {
  return props.turn.role === "user" ? <UserTurnCard {...props} /> : <AssistantTurnCard {...props} />;
}

export const REPLAY_WINDOW_OVERSCAN = 6;

export function replayTurnIndexForPart(turns: readonly ReplayTurn[], partId: string): number {
  return turns.findIndex((turn) => turn.parts.some((part) => part.id === partId));
}

export function WindowedTurnStream({ turns, targetPartId }: { turns: ReplayTurn[]; targetPartId?: string | null }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // OCL-053: TanStack Virtual is intentionally imperative; this is the actual windowing boundary.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => Math.max(180, 120 + (turns[index]?.parts.length ?? 0) * 80),
    overscan: REPLAY_WINDOW_OVERSCAN,
    getItemKey: (index) => turns[index]?.messageId ?? index,
  });

  useEffect(() => {
    if (!targetPartId) return;
    const turnIndex = replayTurnIndexForPart(turns, targetPartId);
    if (turnIndex < 0) return;
    virtualizer.scrollToIndex(turnIndex, { align: "center" });
    const focusTarget = () => {
      const element = document.getElementById(partDomId(targetPartId));
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: "center" });
    };
    requestAnimationFrame(() => requestAnimationFrame(focusTarget));
  }, [targetPartId, turns, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  return <div ref={scrollRef} role="feed" aria-label="Ordered replay turns" className="h-[calc(100vh-15rem)] min-h-[32rem] overflow-auto rounded-lg border border-border bg-muted/20 p-3"><div role="presentation" className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>{virtualItems.map((item) => {
    const turn = turns[item.index];
    if (!turn) return null;
    return <div key={item.key} ref={virtualizer.measureElement} role="presentation" data-index={item.index} className="absolute left-0 top-0 w-full pb-4" style={{ transform: `translateY(${item.start}px)` }}><TurnCard turn={turn} position={item.index + 1} setSize={turns.length} /></div>;
  })}</div></div>;
}

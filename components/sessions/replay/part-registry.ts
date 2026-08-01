import { createElement, type ComponentType } from "react";

import type { OcPartData, ReplayPart, ReplayTurn } from "@/types/oc";

export interface ReplayPartRendererProps {
  part: ReplayPart;
  turn: ReplayTurn;
}

export type ReplayPartRenderer = ComponentType<ReplayPartRendererProps>;
export type ReplayPartType = OcPartData["type"];

function UnknownPartRenderer({ part }: ReplayPartRendererProps) {
  const rawType = part.data.type === "unknown" ? part.data.rawType : part.data.type;
  return createElement(
    "div",
    {
      className: "rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground",
      role: "note",
    },
    createElement("span", { className: "font-medium text-foreground" }, "Unsupported replay part"),
    " · ",
    createElement("code", { className: "font-mono" }, rawType || "unknown"),
  );
}

/**
 * Extending replay parts: a downstream ticket exports a component matching
 * `ReplayPartRenderer`, then calls `registerReplayPartRenderer("tool", ToolPart)`
 * once from its loaded feature module. Keep decoding out of renderers: they
 * receive the frozen, already-decoded `ReplayPart` and its owning turn. Types
 * without a registered component deliberately fall back to the labelled
 * placeholder, so a new upstream shape can never become a blank gap.
 */
export const ReplayPartRendererRegistry: Partial<Record<ReplayPartType, ReplayPartRenderer>> = {
  unknown: UnknownPartRenderer,
};

export function registerReplayPartRenderer(type: ReplayPartType, renderer: ReplayPartRenderer): void {
  ReplayPartRendererRegistry[type] = renderer;
}

export function replayPartRenderer(type: ReplayPartType): ReplayPartRenderer {
  return ReplayPartRendererRegistry[type] ?? UnknownPartRenderer;
}

export function partDomId(partId: string): string {
  return `part-${encodeURIComponent(partId)}`;
}

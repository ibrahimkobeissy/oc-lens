"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Clock3 } from "lucide-react";

import { type ReplayPartRendererProps, registerReplayPartRenderer } from "./part-registry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import { categorizeTool, categoryColor, toolDisplayName } from "@/lib/tools";
import { cn } from "@/lib/utils";
import type { OcPartToolData, ToolStatus } from "@/types/oc";

export const TOOL_OUTPUT_PREVIEW_CHARS = 12_000;
export const TOOL_INPUT_PREVIEW_CHARS = 12_000;
const TOOL_INPUT_VALUE_CHARS = 2_000;

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n… truncated (${value.length - limit} more characters)`;
}

export function prettyPrintToolInput(input: unknown): string {
  let rendered: string;
  try {
    rendered = JSON.stringify(input, (_key, value: unknown) =>
      typeof value === "string" ? truncate(value, TOOL_INPUT_VALUE_CHARS) : value, 2) ?? "undefined";
  } catch {
    rendered = "Input could not be displayed.";
  }
  return truncate(rendered, TOOL_INPUT_PREVIEW_CHARS);
}

export function toolDuration(data: OcPartToolData): number | null {
  if (data.timeStart === null || data.timeEnd === null || data.timeEnd < data.timeStart) return null;
  return data.timeEnd - data.timeStart;
}

function statusVariant(status: ToolStatus): "secondary" | "destructive" | "outline" | "default" {
  if (status === "error") return "destructive";
  if (status === "completed") return "secondary";
  if (status === "running") return "default";
  return "outline";
}

function byteLabel(value: string): string {
  return `${(new TextEncoder().encode(value).length / 1024).toFixed(1)} KB`;
}

function ToolOutput({ data }: { data: OcPartToolData }) {
  const [expanded, setExpanded] = useState(false);
  if (data.output === null) {
    return data.status === "error"
      ? <p role="alert" className="text-sm text-destructive">Tool call failed without a recorded error message.</p>
      : null;
  }

  const long = data.output.length > TOOL_OUTPUT_PREVIEW_CHARS;
  const visible = expanded || !long ? data.output : truncate(data.output, TOOL_OUTPUT_PREVIEW_CHARS);
  return <div className="space-y-2">
    <p className="text-xs font-medium text-muted-foreground">{data.status === "error" ? "Error message" : "Output"}</p>
    <pre role={data.status === "error" ? "alert" : undefined} className={cn("max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 font-mono text-xs", data.status === "error" && "border-destructive/40 bg-destructive/5 text-destructive")}>{visible}</pre>
    {long ? <Button type="button" variant="ghost" size="xs" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
      {expanded ? "Show truncated output" : `Show full output (${byteLabel(data.output)})`}
    </Button> : null}
  </div>;
}

export function ToolCallCard({ data }: { data: OcPartToolData }) {
  const category = categorizeTool(data.tool);
  const displayName = toolDisplayName(data.tool) || "unknown tool";
  const duration = toolDuration(data);
  return <section aria-label={`${displayName} tool call`} className={cn("rounded-lg border border-l-4 bg-card p-3", data.status === "error" && "border-destructive/50 bg-destructive/5")} style={{ borderLeftColor: data.status === "error" ? undefined : categoryColor(category) }}>
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-mono text-sm font-semibold">{displayName}</h4>
          <Badge variant="outline" style={{ borderColor: categoryColor(category) }}>{category}</Badge>
          <Badge variant={statusVariant(data.status)}>{data.status}</Badge>
        </div>
        {data.title ? <p className="mt-1 break-words text-xs text-muted-foreground">{data.title}</p> : null}
      </div>
      <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground" aria-label={`Duration ${formatDuration(duration)}`}><Clock3 aria-hidden="true" className="size-3.5" />{formatDuration(duration)}</span>
    </header>
    {data.status === "error" ? <p className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-destructive"><AlertTriangle aria-hidden="true" className="size-3.5" />Tool call failed</p> : null}
    <div className="mt-3 space-y-3">
      <details className="rounded-md border bg-muted/20 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium">Input arguments</summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">{prettyPrintToolInput(data.input)}</pre>
      </details>
      <ToolOutput data={data} />
    </div>
  </section>;
}

export function ToolPart({ part }: ReplayPartRendererProps) {
  return part.data.type === "tool" ? <ToolCallCard data={part.data} /> : null;
}

registerReplayPartRenderer("tool", ToolPart);

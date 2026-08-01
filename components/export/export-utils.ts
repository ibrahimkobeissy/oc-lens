import type { ExportManifestCounts, ExportResponse } from "@/types/oc";

export const EXPORT_SCOPES = ["sessions", "stats", "activity", "tools", "todos", "replay"] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];

export interface ExportDateRange {
  from?: Date;
  to?: Date;
}

export const SCOPE_DETAILS: Record<ExportScope, { label: string; description: string; file: string }> = {
  sessions: { label: "Sessions", description: "Session metadata, usage, and feature badges", file: "sessions.json" },
  stats: { label: "Overview stats", description: "Aggregate tokens, cost, models, and projects", file: "stats.json" },
  activity: { label: "Activity", description: "Daily, hourly, weekday, and streak analytics", file: "activity.json" },
  tools: { label: "Tools", description: "Tool, error, MCP, skill, and adoption analytics", file: "tools.json" },
  todos: { label: "Todos", description: "Read-only todos and status rollups", file: "todos.json" },
  replay: { label: "Conversation replay", description: "Ordered turns and decoded parts", file: "replays.json" },
};

function calendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function exportUrl(scopes: readonly ExportScope[], range: ExportDateRange, timeZone: string, preview = false): string {
  const params = new URLSearchParams();
  if (preview) params.set("preview", "1");
  if (scopes.length > 0) params.set("scope", scopes.join(","));
  if (range.from) params.set("from", calendarDate(range.from));
  if (range.to) params.set("to", calendarDate(range.to));
  params.set("tz", timeZone);
  return `/api/export?${params.toString()}`;
}

export function previewText(scope: ExportScope, counts: ExportManifestCounts): string {
  switch (scope) {
    case "sessions": return `${counts.sessions.toLocaleString("en-US")} sessions`;
    case "stats": return `Aggregates ${counts.sessions.toLocaleString("en-US")} sessions`;
    case "activity": return `${counts.sessions.toLocaleString("en-US")} session starts`;
    case "tools": return `${counts.parts.toLocaleString("en-US")} parts scanned`;
    case "todos": return `${counts.todos.toLocaleString("en-US")} todos`;
    case "replay": return `${counts.messages.toLocaleString("en-US")} turns · ${counts.parts.toLocaleString("en-US")} parts`;
  }
}

type DatasetKey = "sessions" | "stats" | "activity" | "tools" | "todos" | "replays";

function datasetKey(scope: ExportScope): DatasetKey {
  return scope === "replay" ? "replays" : scope;
}

export interface ExportManifest {
  schemaVersion: string;
  generatedAt: number;
  generatedAtIso: string;
  range: { from: number | null; to: number | null };
  counts: ExportManifestCounts;
  scopes: ExportScope[];
}

export function exportManifest(data: ExportResponse, scopes: readonly ExportScope[]): ExportManifest {
  return {
    schemaVersion: data.schemaVersion,
    generatedAt: data.generatedAt,
    generatedAtIso: new Date(data.generatedAt).toISOString(),
    range: { from: data.rangeFrom, to: data.rangeTo },
    counts: data.counts,
    scopes: [...scopes],
  };
}

export async function createExportZip(data: ExportResponse, scopes: readonly ExportScope[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(exportManifest(data, scopes), null, 2));
  for (const scope of scopes) {
    const key = datasetKey(scope);
    const dataset = data[key];
    if (dataset !== undefined) zip.file(SCOPE_DETAILS[scope].file, JSON.stringify(dataset, null, 2));
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", streamFiles: true });
}

export function downloadName(format: "json" | "zip", generatedAt = Date.now()): string {
  return `oc-lens-export-${new Date(generatedAt).toISOString().slice(0, 10)}.${format}`;
}

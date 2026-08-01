import Link from "next/link";
import { FileClock, FilePenLine } from "lucide-react";

import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import { partDomId } from "@/components/sessions/replay/part-registry";
import { toolDisplayName } from "@/lib/tools";
import type { FileChangeSummary } from "@/types/oc";

function normalizedParts(value: string): { root: string; parts: string[] } {
  const normalized = value.replaceAll("\\", "/");
  const drive = normalized.match(/^[A-Za-z]:/)?.[0]?.toLowerCase() ?? "";
  return { root: drive || (normalized.startsWith("/") ? "/" : ""), parts: normalized.replace(/^[A-Za-z]:/, "").split("/").filter(Boolean) };
}

function canonicalPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const drive = normalized.match(/^[A-Za-z]:/)?.[0] ?? "";
  const rooted = drive.length > 0 || normalized.startsWith("/");
  const parts: string[] = [];
  for (const part of normalized.replace(/^[A-Za-z]:/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length > 0 && parts.at(-1) !== "..") parts.pop();
    else if (part === ".." && !rooted) parts.push(part);
    else if (part !== "..") parts.push(part);
  }
  const prefix = drive ? `${drive}/` : rooted ? "/" : "";
  return `${prefix}${parts.join("/")}` || (rooted ? prefix : ".");
}

export function absoluteFilePath(filePath: string, projectWorktree: string | null): string {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return canonicalPath(filePath);
  if (!projectWorktree) return filePath;
  return canonicalPath(`${projectWorktree}/${filePath}`);
}

export function relativeFilePath(filePath: string, projectWorktree: string | null): string {
  if (!projectWorktree) return filePath;
  const file = normalizedParts(filePath);
  const project = normalizedParts(projectWorktree);
  if (file.root !== project.root) return filePath;
  let common = 0;
  while (common < file.parts.length && common < project.parts.length && file.parts[common] === project.parts[common]) common += 1;
  const relative = [...project.parts.slice(common).map(() => ".."), ...file.parts.slice(common)].join("/");
  return relative || ".";
}

function replayHref(change: FileChangeSummary): string {
  return `/sessions/${encodeURIComponent(change.sessionId)}?part=${encodeURIComponent(change.partId)}#${partDomId(change.partId)}`;
}

export function FileTimeline({ changes, projectWorktree }: { changes: FileChangeSummary[]; projectWorktree: string | null }) {
  if (changes.length === 0) {
    return <EmptyState icon={<FileClock aria-hidden="true" />} title="No verified file touches" description="No completed write, edit, or patch tool call recorded a usable file path for this session. Data caveats above identify calls with missing path evidence." />;
  }

  return <section className="rounded-lg border bg-card p-4" aria-labelledby="file-timeline-title">
    <header className="mb-4">
      <h2 id="file-timeline-title" className="flex items-center gap-2 font-semibold"><FilePenLine aria-hidden="true" className="size-4" />File changes</h2>
      <p className="mt-1 text-xs text-muted-foreground">Verified file touches in recorded call order; actual diffs are not read.</p>
    </header>
    <ol className="space-y-3 border-l border-border pl-4">
      {changes.map((change) => {
        const absolutePath = absoluteFilePath(change.filePath, projectWorktree);
        return <li key={change.partId} className="relative min-w-0 rounded-md border bg-muted/20 p-3 before:absolute before:-left-[1.3rem] before:top-4 before:size-2 before:rounded-full before:bg-primary">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href={replayHref(change)} title={absolutePath} className="min-w-0 break-all font-mono text-sm font-medium text-primary hover:underline">{relativeFilePath(absolutePath, projectWorktree)}</Link>
          <Badge variant="outline">{toolDisplayName(change.tool) || "unknown tool"}</Badge>
        </div>
        <time suppressHydrationWarning dateTime={new Date(change.timeCreated).toISOString()} className="mt-1 block text-xs text-muted-foreground">{new Date(change.timeCreated).toLocaleString()}</time>
      </li>;
      })}
    </ol>
  </section>;
}

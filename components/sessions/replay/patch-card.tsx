import { GitCommitHorizontal } from "lucide-react";

import { registerReplayPartRenderer, type ReplayPartRendererProps } from "./part-registry";

/**
 * A workspace-wide diff snapshot — deliberately **not** presented as "this session's
 * file changes." Confirmed live 2026-08-02 (data-model §5): the same hash/files pair
 * has been observed attached to messages in two different sessions, including a file
 * a subagent wrote that the owning message's own tool calls never touched. Rendered
 * as raw, honest evidence only — the file-change timeline (OCL-103) does not use this
 * as session-scoped evidence for the same reason.
 */
export function PatchCard({ part }: ReplayPartRendererProps) {
  if (part.data.type !== "patch") return null;
  const { hash, files } = part.data;

  return (
    <details className="group rounded-lg border border-border bg-muted/20">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
        <GitCommitHorizontal aria-hidden="true" className="size-4 text-primary" />
        <span className="font-medium text-foreground">Workspace diff snapshot</span>
        <span className="font-mono text-xs">{files.length} file{files.length === 1 ? "" : "s"}</span>
        <span className="ml-auto font-mono text-xs" title={hash}>{hash.slice(0, 8)}</span>
      </summary>
      <div className="border-t border-border px-3 py-3 text-xs text-muted-foreground">
        <p className="mb-2">Reflects the whole working tree at this point in time — not necessarily changes made by this session.</p>
        {files.length > 0 ? (
          <ul className="space-y-1 font-mono">
            {files.map((file) => <li key={file} className="break-all">{file}</li>)}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

registerReplayPartRenderer("patch", PatchCard);

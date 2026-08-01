import Link from "next/link";
import { ArrowRight, Clock3, Folder, MessageSquare, Radio, WalletCards } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCost, formatNumber, formatTokens } from "@/lib/format";
import type { ProjectSummary } from "@/types/oc";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function totalTokens(project: ProjectSummary): number {
  return project.tokens.input
    + project.tokens.output
    + project.tokens.reasoning
    + project.tokens.cacheRead
    + project.tokens.cacheWrite;
}

function LastActive({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">No activity</span>;
  const date = new Date(value);
  return <time dateTime={date.toISOString()} title={date.toISOString()}>{dateFormatter.format(date)}</time>;
}

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const href = `/projects/${encodeURIComponent(project.id)}`;

  return (
    <Card className="h-full gap-5 py-5 transition-colors hover:border-primary/40">
      <CardHeader className="gap-3 px-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-md border border-border bg-muted p-2 text-muted-foreground">
            <Folder aria-hidden="true" className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle>
              <Link href={href} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="break-words">{project.displayName}</span>
              </Link>
            </CardTitle>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{project.id}</p>
          </div>
        </div>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <p
                className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-left font-mono text-xs text-muted-foreground [direction:rtl]"
                aria-label={`Worktree: ${project.worktree}`}
              >
                <span className="[direction:ltr]">{project.worktree || "No worktree recorded"}</span>
              </p>
            </TooltipTrigger>
            <TooltipContent className="max-w-[min(32rem,calc(100vw-2rem))] break-all font-mono text-xs">
              {project.worktree || "No worktree recorded"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </CardHeader>

      <CardContent className="mt-auto space-y-4 px-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Radio aria-hidden="true" className="size-3.5" /> Sessions
            </dt>
            <dd className="mt-1 font-mono font-medium tabular-nums">{formatNumber(project.sessionCount)}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MessageSquare aria-hidden="true" className="size-3.5" /> Messages
            </dt>
            <dd className="mt-1 font-mono font-medium tabular-nums">{formatNumber(project.messageCount)}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <WalletCards aria-hidden="true" className="size-3.5" /> Tokens
            </dt>
            <dd className="mt-1 font-mono font-medium tabular-nums" title={formatNumber(totalTokens(project))}>
              {formatTokens(totalTokens(project))}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">User-priced cost</dt>
            <dd className={project.cost.priced ? "mt-1 font-mono font-medium tabular-nums" : "mt-1 text-xs text-muted-foreground"}>
              {formatCost(project.cost)}
            </dd>
          </div>
        </dl>

        <div className="flex items-center gap-2 border-t border-border pt-4 text-xs">
          <Clock3 aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">Last active</span>
          <span className="ml-auto text-right"><LastActive value={project.lastActivity} /></span>
        </div>

        <Link
          href={href}
          className="flex items-center justify-end gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          View project <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}

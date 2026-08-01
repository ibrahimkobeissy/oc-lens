import { Sparkles } from "lucide-react";

import { EmptyState } from "@/components/states/empty-state";
import { formatDuration, formatNumber } from "@/lib/format";
import type { SkillSummary } from "@/types/oc";

export interface SkillRankingRow extends SkillSummary {
  successPct: number;
  errorPct: number;
}

export function rankedSkills(skills: readonly SkillSummary[]): SkillRankingRow[] {
  return [...skills].filter((skill) => skill.totalCalls > 0)
    .sort((left, right) => right.totalCalls - left.totalCalls || left.skill.localeCompare(right.skill))
    .map((skill) => {
      const errorCount = Math.min(skill.totalCalls, Math.max(0, skill.errorCount));
      const errorPct = errorCount / skill.totalCalls;
      return { ...skill, errorCount, errorPct, successPct: 1 - errorPct };
    });
}

export function SkillRankingChart({ skills }: { skills: SkillSummary[] }) {
  const rows = rankedSkills(skills);
  if (rows.length === 0) return <EmptyState icon={<Sparkles aria-hidden="true" />} title="No skill invocations" description="Observed skill calls will appear here after a session invokes the skill tool." />;
  const maximum = Math.max(...rows.map((row) => row.totalCalls), 1);
  return <section aria-labelledby="skill-ranking-heading" className="rounded-lg border border-border bg-card p-4"><header><h2 id="skill-ranking-heading" className="font-semibold">Skill invocation analytics</h2><p className="mt-1 text-xs text-muted-foreground">Observed skill-tool calls, sessions, and duration. Success means no error status was recorded.</p></header><ol className="mt-4 space-y-3">{rows.map((row) => <li key={row.skill} className="rounded-lg border border-border p-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><span className="min-w-0 truncate font-mono text-sm font-medium" title={row.skill}>/{row.skill}</span><span className="shrink-0 font-mono text-sm tabular-nums">{formatNumber(row.totalCalls)} calls</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full rounded-full bg-primary" style={{ width: `${(row.totalCalls / maximum) * 100}%` }} /></div><dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-5"><div><dt className="text-muted-foreground">Sessions</dt><dd className="mt-0.5 font-mono tabular-nums">{formatNumber(row.sessionCount)}</dd></div><div><dt className="text-muted-foreground">Success</dt><dd className="mt-0.5 font-mono tabular-nums">{(row.successPct * 100).toFixed(1)}%</dd></div><div><dt className="text-muted-foreground">Errors</dt><dd className="mt-0.5 font-mono tabular-nums">{row.errorCount} · {(row.errorPct * 100).toFixed(1)}%</dd></div><div><dt className="text-muted-foreground">p50 duration</dt><dd className="mt-0.5 font-mono tabular-nums">{formatDuration(row.p50DurationMs)}</dd></div><div><dt className="text-muted-foreground">p95 duration</dt><dd className="mt-0.5 font-mono tabular-nums">{formatDuration(row.p95DurationMs)}</dd></div></dl></li>)}</ol></section>;
}

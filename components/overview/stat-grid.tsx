"use client";

import Link from "next/link";

import { StatCard } from "@/components/ui/stat-card";
import { formatBytes, formatCost } from "@/lib/format";
import type { OcTokens, OverviewStats } from "@/types/oc";

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function duration(value: number | null): string {
  if (value === null) return "not available";
  const seconds = Math.max(0, Math.round(value / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function bytes(value: number | null): string {
  return value === null ? "loading" : formatBytes(value);
}

function tokenTotal(tokens: OcTokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite;
}

function CostCard({ stats }: { stats: OverviewStats }) {
  if (!stats.totalCost.priced) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
        <p className="text-xs font-medium text-muted-foreground">Estimated cost</p>
        <p className="mt-1 font-mono text-2xl font-semibold">not priced</p>
        <Link className="mt-1 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline" href="/settings/pricing">
          Set model prices
        </Link>
      </div>
    );
  }
  return <StatCard label="Estimated cost" value={formatCost(stats.totalCost)} subLabel="From your model prices" />;
}

export function StatGrid({ stats, storageBytes }: { stats: OverviewStats; storageBytes: number | null }) {
  const tokens = stats.totalTokens;
  const cache = tokens.cacheRead + tokens.cacheWrite;
  return (
    <section aria-label="Overview statistics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Sessions" value={stats.totalSessions} />
      <StatCard label="Messages" value={stats.totalMessages} />
      <StatCard
        label="Tokens"
        value={tokenTotal(tokens)}
        formatValue={compact}
        subLabel={`Input ${compact(tokens.input)} · Output ${compact(tokens.output)} · Cache ${compact(cache)}`}
      />
      <CostCard stats={stats} />
      <StatCard label="Active days" value={stats.activeDays} />
      <StatCard label="Average session" value={duration(stats.avgSessionLengthMs)} />
      <StatCard label="Sessions this week" value={stats.sessionsThisWeek} subLabel={`${stats.sessionsThisMonth.toLocaleString("en-US")} this month`} />
      <StatCard label="Storage" value={bytes(storageBytes)} subLabel={storageBytes === null ? "Reading local footprint" : "Database and opencode data"} />
    </section>
  );
}

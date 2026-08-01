"use client";

import { EmptyState } from "@/components/states/empty-state";
import { chartColor } from "@/components/charts/chart-colors";
import { formatNumber, formatTokens } from "@/lib/format";
import type { ModelUsage, OcTokens, OverviewStats } from "@/types/oc";

const TOKEN_CATEGORIES = [
  { key: "input", label: "Input", color: chartColor(0) },
  { key: "output", label: "Output", color: chartColor(1) },
  { key: "reasoning", label: "Reasoning", color: chartColor(2) },
  { key: "cacheRead", label: "Cache read", color: chartColor(3) },
  { key: "cacheWrite", label: "Cache write", color: chartColor(4) },
] as const;

function tokenTotal(tokens: OcTokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite;
}

function label(model: ModelUsage): string {
  return model.providerID === "unknown" || model.modelID === "unknown"
    ? "unknown"
    : `${model.providerID}/${model.modelID}`;
}

export interface ModelTokenRow {
  key: string;
  label: string;
  tokens: OcTokens;
  total: number;
}

export function modelTokenRows(stats: Pick<OverviewStats, "modelBreakdown">): ModelTokenRow[] {
  const rows = new Map<string, ModelTokenRow>();
  for (const model of stats.modelBreakdown) {
    const modelLabel = label(model);
    const row = rows.get(modelLabel) ?? {
      key: modelLabel,
      label: modelLabel,
      tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      total: 0,
    };
    for (const category of TOKEN_CATEGORIES) row.tokens[category.key] += model.tokens[category.key];
    row.total = tokenTotal(row.tokens);
    rows.set(modelLabel, row);
  }
  return [...rows.values()]
    .filter((row) => row.total > 0)
    .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label));
}

export function TokenBreakdownPanel({ stats }: { stats: OverviewStats }) {
  const rows = modelTokenRows(stats);
  if (rows.length === 0) {
    return <EmptyState title="No token data" description="No model token usage is available for this range." />;
  }

  return (
    <section aria-labelledby="token-breakdown-title" className="rounded-lg border border-border bg-card p-4">
      <h3 id="token-breakdown-title" className="text-sm font-medium text-foreground">Token breakdown by model</h3>
      <ul aria-label="Token categories" className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {TOKEN_CATEGORIES.map((category) => (
          <li key={category.key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ background: category.color }} />
            {category.label}
          </li>
        ))}
      </ul>

      <div className="mt-5 space-y-5">
        {rows.map((row) => (
          <article key={row.key}>
            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
              <h4 className="min-w-0 truncate font-mono text-foreground" title={row.label}>{row.label}</h4>
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground" title={`${formatNumber(row.total)} tokens`}>
                {formatTokens(row.total)}
              </span>
            </div>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
              {TOKEN_CATEGORIES.map((category) => {
                const value = row.tokens[category.key];
                return value > 0 ? (
                  <span
                    key={category.key}
                    style={{ width: `${(value / row.total) * 100}%`, background: category.color }}
                  />
                ) : null;
              })}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-5">
              {TOKEN_CATEGORIES.map((category) => (
                <div key={category.key} className="flex justify-between gap-2 sm:block">
                  <dt className="text-muted-foreground">{category.label}</dt>
                  <dd className="font-mono tabular-nums text-foreground">{formatTokens(row.tokens[category.key])}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

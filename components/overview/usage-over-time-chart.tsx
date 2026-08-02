"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartContainer } from "@/components/charts/chart-container";
import { chartColor } from "@/components/charts/chart-colors";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import { EmptyState } from "@/components/states/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTokens } from "@/lib/format";
import type { DailyActivity, OcTokens } from "@/types/oc";

export function usageRows(
  activity: readonly DailyActivity[],
  dailyTokens: readonly { date: string; tokens: OcTokens }[],
): Array<{ date: string; messages: number; tokens: number }> {
  const rows = new Map<string, { date: string; messages: number; tokens: number }>();
  for (const day of activity) rows.set(day.date, { date: day.date, messages: day.messageCount, tokens: 0 });
  for (const day of dailyTokens) {
    const row = rows.get(day.date) ?? { date: day.date, messages: 0, tokens: 0 };
    row.tokens = day.tokens.input + day.tokens.output + day.tokens.reasoning + day.tokens.cacheRead + day.tokens.cacheWrite;
    rows.set(day.date, row);
  }
  return [...rows.values()].sort((left, right) => left.date.localeCompare(right.date));
}

const MESSAGES_COLOR = chartColor(0);
const TOKENS_COLOR = chartColor(1);
const SERIES = [{ key: "messages", label: "Messages" }, { key: "tokens", label: "Tokens" }];

export function UsageOverTimeChart({ activity, dailyTokens }: { activity: DailyActivity[]; dailyTokens: Array<{ date: string; tokens: OcTokens }> }) {
  const rows = useMemo(() => usageRows(activity, dailyTokens), [activity, dailyTokens]);

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Usage over time</CardTitle>
        <CardDescription>Messages and session-token totals by local calendar day, plotted together.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState title="No data" description="No usage was recorded in this range." />
        ) : (
          <ChartContainer
            ariaLabel="Usage over time: messages and tokens"
            height={300}
            srSummary={<ChartDataTable data={rows} xKey="date" xLabel="Local date" series={SERIES} />}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ left: 4, right: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} />
                <YAxis
                  yAxisId="messages"
                  stroke={MESSAGES_COLOR}
                  fontSize={12}
                  tickLine={false}
                  allowDecimals={false}
                  label={{ value: "Messages", angle: -90, position: "insideLeft", fill: MESSAGES_COLOR, fontSize: 11 }}
                />
                <YAxis
                  yAxisId="tokens"
                  orientation="right"
                  stroke={TOKENS_COLOR}
                  fontSize={12}
                  tickLine={false}
                  tickFormatter={(value: number) => formatTokens(value)}
                  label={{ value: "Tokens", angle: 90, position: "insideRight", fill: TOKENS_COLOR, fontSize: 11 }}
                />
                <Tooltip
                  formatter={(value, name) => [name === "Tokens" && typeof value === "number" ? formatTokens(value) : value, name]}
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    color: "var(--popover-foreground)",
                    fontSize: 12,
                  }}
                />
                <Line yAxisId="messages" type="monotone" dataKey="messages" name="Messages" stroke={MESSAGES_COLOR} strokeWidth={2} dot={false} />
                <Line yAxisId="tokens" type="monotone" dataKey="tokens" name="Tokens" stroke={TOKENS_COLOR} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

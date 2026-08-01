"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/components/states/empty-state";
import { ChartContainer } from "./chart-container";
import { ChartDataTable, type ChartSeries } from "./chart-data-table";
import { chartColor } from "./chart-colors";

interface AreaChartCardProps {
  title?: string;
  data: Array<Record<string, string | number>>;
  xKey: string;
  xLabel?: string;
  series: ChartSeries[];
  emptyMessage?: string;
  height?: number;
  stacked?: boolean;
}

export function AreaChartCard({
  title,
  data,
  xKey,
  xLabel,
  series,
  emptyMessage = "No data for this range.",
  height = 280,
  stacked = true,
}: AreaChartCardProps) {
  if (data.length === 0) {
    return (
      <div className="w-full">
        {title && <h3 className="mb-2 text-sm font-medium text-foreground">{title}</h3>}
        <EmptyState title="No data" description={emptyMessage} />
      </div>
    );
  }

  return (
    <ChartContainer
      title={title}
      ariaLabel={title ?? "Area chart"}
      height={height}
      srSummary={<ChartDataTable data={data} xKey={xKey} xLabel={xLabel} series={series} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey={xKey} stroke="var(--muted-foreground)" fontSize={12} tickLine={false} />
          <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
          />
          {series.map((s, i) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={chartColor(i)}
              fill={chartColor(i)}
              fillOpacity={0.2}
              stackId={stacked ? "stack" : undefined}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

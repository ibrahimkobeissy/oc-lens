"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { EmptyState } from "@/components/states/empty-state";
import { chartColor } from "./chart-colors";

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
}

interface DonutChartCardProps {
  title?: string;
  data: DonutSlice[];
  emptyMessage?: string;
  height?: number;
}

export function DonutChartCard({ title, data, emptyMessage = "No data for this range.", height = 240 }: DonutChartCardProps) {
  if (data.length === 0) {
    return (
      <div className="w-full">
        {title && <h3 className="mb-2 text-sm font-medium text-foreground">{title}</h3>}
        <EmptyState title="No data" description={emptyMessage} />
      </div>
    );
  }

  return (
    <div className="w-full">
      {title && <h3 className="mb-2 text-sm font-medium text-foreground">{title}</h3>}
      <div role="img" aria-label={title ?? "Donut chart"} className="w-full overflow-x-auto" style={{ height }}>
        <div style={{ minWidth: 240, height: "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" innerRadius="55%" outerRadius="80%" paddingAngle={2}>
                {data.map((slice, i) => (
                  <Cell key={slice.key} fill={chartColor(i)} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--popover-foreground)",
                  fontSize: 12,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {data.map((slice, i) => (
          <li key={slice.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: chartColor(i) }} />
            {slice.label} ({slice.value})
          </li>
        ))}
      </ul>
      <div className="sr-only">
        <table>
          <caption>Underlying data for the donut chart above</caption>
          <thead>
            <tr>
              <th scope="col">Label</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {data.map((slice) => (
              <tr key={slice.key}>
                <td>{slice.label}</td>
                <td>{slice.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

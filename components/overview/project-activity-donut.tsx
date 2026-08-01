"use client";

import { BreakdownDonut, collapseBreakdownSlices, type BreakdownSlice } from "./model-breakdown-donut";
import type { OverviewStats } from "@/types/oc";

export function projectActivitySlices(stats: Pick<OverviewStats, "projectBreakdown">): BreakdownSlice[] {
  return collapseBreakdownSlices(stats.projectBreakdown.map((project) => ({
    key: project.id,
    label: project.id === "global" ? "global" : project.displayName,
    value: project.sessionCount,
  })));
}

export function ProjectActivityDonut({ stats }: { stats: OverviewStats }) {
  return (
    <BreakdownDonut
      title="Project activity"
      slices={projectActivitySlices(stats)}
      emptyMessage="No project activity is available for this range."
    />
  );
}

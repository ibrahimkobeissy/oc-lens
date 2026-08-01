"use client";
import { StatCard } from "@/components/ui/stat-card";
import type { TodoRollup as TodoRollupData } from "@/types/oc";

export function TodoRollup({ rollup }: { rollup: TodoRollupData }) {
  const total = rollup.pending + rollup.inProgress + rollup.completed + rollup.unknown;
  const rate = total === 0 ? 0 : Math.round((rollup.completed / total) * 100);
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="Pending" value={rollup.pending} /><StatCard label="In progress" value={rollup.inProgress} /><StatCard label="Completed" value={rollup.completed} /><StatCard label="Completion" value={`${rate}%`} subLabel={total === 0 ? "No todos recorded" : `${total} total`} /></div>;
}

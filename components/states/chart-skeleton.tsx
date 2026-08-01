import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholder for any chart primitive, matched to typical chart proportions. */
export function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <div className="space-y-3" style={{ height }}>
      <Skeleton className="h-full w-full rounded-md" />
    </div>
  );
}

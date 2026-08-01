import { Skeleton } from "@/components/ui/skeleton";

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

/** Loading placeholder for any table primitive — a fixed grid of skeleton cells, not a spinner. */
export function TableSkeleton({ rows = 5, columns = 4 }: TableSkeletonProps) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading table data">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3">
          {Array.from({ length: columns }, (_, colIndex) => (
            <Skeleton key={colIndex} className="h-6 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

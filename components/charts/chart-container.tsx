import type { ReactNode } from "react";

interface ChartContainerProps {
  title?: string;
  ariaLabel: string;
  srSummary?: ReactNode;
  children: ReactNode;
  height?: number;
}

/**
 * Shared chart chrome: an accessible landmark for the chart region, a
 * horizontal-scroll wrapper scoped to the chart itself (never the page body),
 * and a slot for a visually-hidden data-table fallback for screen readers.
 */
export function ChartContainer({ title, ariaLabel, srSummary, children, height = 280 }: ChartContainerProps) {
  return (
    <div className="w-full">
      {title && <h3 className="mb-2 text-sm font-medium text-foreground">{title}</h3>}
      <div role="img" aria-label={ariaLabel} className="w-full overflow-x-auto" style={{ height }}>
        <div style={{ minWidth: 320, height: "100%" }}>{children}</div>
      </div>
      {srSummary && <div className="sr-only">{srSummary}</div>}
    </div>
  );
}

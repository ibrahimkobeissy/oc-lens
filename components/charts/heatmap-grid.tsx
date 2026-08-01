import { EmptyState } from "@/components/states/empty-state";

export interface HeatmapCell {
  /** Shown in the tooltip and the screen-reader table, e.g. a formatted date. */
  label: string;
  /** `null` means "no cell here" (e.g. padding before the first real day) — rendered blank, distinct from a real `0`. */
  value: number | null;
}

interface HeatmapGridProps {
  /**
   * Each inner array is one column, top-to-bottom in whatever day order the
   * caller wants. This primitive does no date math, locale, or timezone
   * bucketing itself — that's the consuming page's job (e.g. OCL-032's
   * activity heatmap), which knows what a "week" and a "day" mean for its data.
   */
  weeks: HeatmapCell[][];
  emptyMessage?: string;
  onCellClick?: (cell: HeatmapCell) => void;
}

/** A GitHub-style activity grid: intensity-shaded cells from `--accent`, never a hardcoded hex. */
export function HeatmapGrid({ weeks, emptyMessage = "No activity to show.", onCellClick }: HeatmapGridProps) {
  const allValues = weeks.flat().map((cell) => cell.value).filter((value): value is number => value !== null);

  if (allValues.length === 0) {
    return <EmptyState title="No data" description={emptyMessage} />;
  }

  const max = Math.max(...allValues, 1);

  return (
    <div className="w-full">
      <div className="w-full overflow-x-auto" role="group" aria-label="Activity heatmap days">
        <div className="inline-grid grid-flow-col gap-1" style={{ minWidth: weeks.length * 14 }}>
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="grid grid-rows-7 gap-1">
              {week.map((cell, dayIndex) => {
                const title = cell.value === null ? cell.label : `${cell.label}: ${cell.value}`;
                const style = {
                  background:
                    cell.value === null
                      ? "transparent"
                      : cell.value === 0
                        ? "var(--muted)"
                        : `color-mix(in oklab, var(--accent) ${Math.round((cell.value / max) * 85 + 15)}%, var(--muted))`,
                };
                return onCellClick && cell.value !== null ? (
                  <button
                    key={dayIndex}
                    type="button"
                    aria-label={title}
                    title={title}
                    onClick={() => onCellClick(cell)}
                    className="h-3 w-3 rounded-sm border border-border/50"
                    style={style}
                  />
                ) : (
                  <span key={dayIndex} aria-hidden="true" title={title} className="h-3 w-3 rounded-sm border border-border/50" style={style} />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="sr-only">
        <table>
          <caption>Underlying data for the activity heatmap above</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {weeks.flat().map((cell, i) => (
              <tr key={i}>
                <td>{cell.label}</td>
                <td>{cell.value ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

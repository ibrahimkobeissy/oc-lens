import type { CSSProperties } from "react";
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
  /** One label per column (e.g. a month name on the week it starts), same length as `weeks`. `null`/`""` renders blank. */
  columnLabels?: ReadonlyArray<string | null>;
  /** One label per row (e.g. a weekday abbreviation), same length as the tallest column. `null`/`""` renders blank. */
  rowLabels?: ReadonlyArray<string | null>;
}

const LEGEND_STEPS = [0, 0.25, 0.5, 0.75, 1] as const;

function intensityStyle(fraction: number | null): CSSProperties {
  if (fraction === null) return { background: "transparent" };
  if (fraction === 0) return { background: "var(--muted)" };
  // `--accent` is a near-neutral hover-highlight token (barely distinguishable
  // at any intensity); `--success` is the token actually saturated enough to
  // read as a "more activity" gradient, matching the familiar green heatmap.
  return { background: `color-mix(in oklab, var(--success) ${Math.round(fraction * 85 + 15)}%, var(--muted))` };
}

/** A GitHub-style activity grid: intensity-shaded cells from `--success`, never a hardcoded hex. Column widths are fluid so the grid never needs horizontal scroll. */
export function HeatmapGrid({ weeks, emptyMessage = "No activity to show.", onCellClick, columnLabels, rowLabels }: HeatmapGridProps) {
  const allValues = weeks.flat().map((cell) => cell.value).filter((value): value is number => value !== null);

  if (allValues.length === 0) {
    return <EmptyState title="No data" description={emptyMessage} />;
  }

  const max = Math.max(...allValues, 1);
  const rowCount = Math.max(1, ...weeks.map((week) => week.length));

  return (
    <div className="w-full space-y-2">
      <div
        role="group"
        aria-label="Activity heatmap days"
        className="grid w-full gap-1"
        style={{
          gridTemplateColumns: `auto repeat(${weeks.length}, minmax(0, 1fr))`,
          gridTemplateRows: `auto repeat(${rowCount}, minmax(0, 1fr))`,
        }}
      >
        <div aria-hidden="true" style={{ gridColumn: 1, gridRow: 1 }} />
        {weeks.map((_, weekIndex) => {
          const label = columnLabels?.[weekIndex];
          return label ? (
            <div key={`month-${weekIndex}`} style={{ gridColumn: weekIndex + 2, gridRow: 1 }} className="text-[10px] leading-none text-muted-foreground">
              {label}
            </div>
          ) : null;
        })}
        {Array.from({ length: rowCount }, (_, rowIndex) => {
          const label = rowLabels?.[rowIndex];
          return label ? (
            <div key={`weekday-${rowIndex}`} style={{ gridColumn: 1, gridRow: rowIndex + 2 }} className="flex items-center pr-1 text-[10px] leading-none text-muted-foreground">
              {label}
            </div>
          ) : (
            <div key={`weekday-${rowIndex}`} aria-hidden="true" style={{ gridColumn: 1, gridRow: rowIndex + 2 }} />
          );
        })}
        {weeks.map((week, weekIndex) =>
          week.map((cell, dayIndex) => {
            const title = cell.value === null ? cell.label : `${cell.label}: ${cell.value}`;
            const style: CSSProperties = { ...intensityStyle(cell.value === null ? null : cell.value / max), gridColumn: weekIndex + 2, gridRow: dayIndex + 2 };
            return onCellClick && cell.value !== null ? (
              <button
                key={dayIndex}
                type="button"
                aria-label={title}
                title={title}
                onClick={() => onCellClick(cell)}
                className="aspect-square w-full min-w-0 rounded-sm border border-border/50"
                style={style}
              />
            ) : (
              <span key={dayIndex} aria-hidden="true" title={title} className="aspect-square w-full min-w-0 rounded-sm border border-border/50" style={style} />
            );
          }),
        )}
      </div>
      <div className="flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
        <span>Less</span>
        {LEGEND_STEPS.map((fraction) => (
          <span key={fraction} aria-hidden="true" className="size-3 rounded-sm border border-border/50" style={intensityStyle(fraction)} />
        ))}
        <span>More</span>
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

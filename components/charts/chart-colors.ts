/**
 * The 8-hue categorical chart palette from app/globals.css (OCL-002). Chart
 * series read these CSS custom properties directly rather than a hardcoded
 * hex, so they stay correct in both themes automatically.
 */
export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
] as const;

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length] as string;
}

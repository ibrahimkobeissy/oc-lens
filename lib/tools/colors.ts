import type { ToolCategory } from "@/types/oc";
import { categorizeTool } from "./categories";

/**
 * Maps each of the 7 `ToolCategory` values to one of OCL-002's 8 categorical
 * chart hues (app/globals.css --chart-1..8), each a distinct colour so tool
 * mixes read clearly on a chart. `other` gets --chart-7 (red) deliberately —
 * an "honest gap" category benefits from reading as attention-worthy rather
 * than blending in. --chart-5 (rose) is intentionally unused, reserved
 * headroom for a future 8th category.
 */
const CATEGORY_CHART_VAR: Record<ToolCategory, string> = {
  file: "var(--chart-1)", // blue
  web: "var(--chart-2)", // green
  exec: "var(--chart-3)", // amber
  planning: "var(--chart-4)", // purple
  search: "var(--chart-6)", // cyan
  other: "var(--chart-7)", // red
  delegation: "var(--chart-8)", // indigo
};

export function categoryColor(category: ToolCategory): string {
  return CATEGORY_CHART_VAR[category];
}

export function toolColor(name: string): string {
  return categoryColor(categorizeTool(name));
}

import type { OcWarning, ToolCategory } from "@/types/oc";

/**
 * opencode's own lowercase tool names (data-model.md §5) mapped to the
 * product's 7 categories. This is a rewrite, not a port — Claude Code's
 * PascalCase tool names in .reference/cc-lens have nothing in common with
 * these.
 *
 * `invalid` maps to `other` deliberately, not as a fallback: it's opencode's
 * own sentinel for a tool call that didn't resolve to a real tool, so `other`
 * is the honest category, not a gap in this table.
 */
export const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  read: "file",
  write: "file",
  edit: "file",
  patch: "file",
  bash: "exec",
  grep: "search",
  glob: "search",
  list: "search",
  webfetch: "web",
  todowrite: "planning",
  todoread: "planning",
  task: "delegation",
  skill: "delegation",
  question: "planning",
  invalid: "other",
};

const DISPLAY_NAMES: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  patch: "Patch",
  bash: "Bash",
  grep: "Grep",
  glob: "Glob",
  list: "List",
  webfetch: "Web Fetch",
  todowrite: "Todo Write",
  todoread: "Todo Read",
  task: "Task",
  skill: "Skill",
  question: "Question",
  invalid: "Invalid",
};

/** Unrecognised tool names fall to `other` — an honest gap, never hidden. */
export function categorizeTool(name: string): ToolCategory {
  const key = name.toLowerCase();
  return Object.hasOwn(TOOL_CATEGORIES, key) ? TOOL_CATEGORIES[key]! : "other";
}

export function toolDisplayName(name: string): string {
  const key = name.toLowerCase();
  return Object.hasOwn(DISPLAY_NAMES, key) ? DISPLAY_NAMES[key]! : name;
}

export interface ToolCategorizationBatch {
  categories: Record<string, ToolCategory>;
  warnings: OcWarning[];
}

/**
 * Batch form: aggregates one `unknown-tool` warning per distinct unrecognised
 * name, with a count — mirrors the decoder-layer convention (OCL-012) of
 * surfacing "N rows had X" rather than one warning per row.
 */
export function categorizeToolsBatch(names: string[]): ToolCategorizationBatch {
  const categories: Record<string, ToolCategory> = {};
  const unknownCounts = new Map<string, number>();

  for (const name of names) {
    const key = name.toLowerCase();
    if (Object.hasOwn(TOOL_CATEGORIES, key)) {
      categories[name] = TOOL_CATEGORIES[key]!;
    } else {
      categories[name] = "other";
      unknownCounts.set(name, (unknownCounts.get(name) ?? 0) + 1);
    }
  }

  const warnings: OcWarning[] = Array.from(unknownCounts.entries()).map(([name, count]) => ({
    code: "unknown-tool",
    message: `Tool "${name}" is not in the known opencode tool set and was categorised as "other".`,
    count,
  }));

  return { categories, warnings };
}

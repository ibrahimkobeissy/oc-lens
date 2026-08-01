export type ToolErrorCategory = "file-not-found" | "string-not-found" | "permission-denied" | "timeout" | "syntax" | "other";

/**
 * A small, evidence-derived set of tool-error categories. There is no real
 * fixture yet (OCL-013 is a sibling ticket) to mine actual opencode error
 * text from, so these patterns are built from the realistic error shapes
 * data-model.md §5 describes for `read`/`write`/`edit`/`bash`/`grep` failures
 * (missing file, missing search string, denied permission, a hung process,
 * malformed input). OCL-074 validates real-fixture coverage later and may
 * extend this table — that is its amendment to make, not a gap here.
 */
const PATTERNS: Array<{ category: ToolErrorCategory; test: RegExp }> = [
  { category: "file-not-found", test: /enoent|no such file|file .*(does not exist|not found)/i },
  { category: "string-not-found", test: /string not found|no matches? found|pattern not found/i },
  { category: "permission-denied", test: /permission denied|eacces|not permitted/i },
  { category: "timeout", test: /timed? ?out|etimedout/i },
  { category: "syntax", test: /syntax error|unexpected token|parse error/i },
];

export function categorizeToolError(message: string): ToolErrorCategory {
  for (const { category, test } of PATTERNS) {
    if (test.test(message)) return category;
  }
  return "other";
}

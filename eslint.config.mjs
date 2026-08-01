import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Sibling agent worktrees live under .claude/worktrees/ inside the repo
    // tree (see Agent tool isolation:"worktree") — never lint another
    // in-flight worktree's files (or their own nested .next/**) from here.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;

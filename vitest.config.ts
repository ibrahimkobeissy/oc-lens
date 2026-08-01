import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": import.meta.dirname },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", ".reference/**", ".claude/worktrees/**"],
    // W8 test-harness amendment: fixture determinism tests rebuild the shared
    // SQLite files, so test files must not read/copy them in parallel.
    fileParallelism: false,
    maxWorkers: 1,
    passWithNoTests: true,
  },
});

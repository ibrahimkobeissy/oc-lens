import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: packageRoot,
  outputFileTracingExcludes: {
    "*": [
      ".claude/**",
      ".git/**",
      ".reference/**",
      "project-docs/**",
      "test/**",
      "AGENTS.md",
      "CLAUDE.md",
      "node_modules/.cache/**",
    ],
  },
  turbopack: {
    root: packageRoot,
  },
};

export default nextConfig;

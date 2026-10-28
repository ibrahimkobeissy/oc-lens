import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  // Dev only: lets hot reload work when the app is opened at 127.0.0.1 instead of localhost.
  allowedDevOrigins: ["127.0.0.1"],
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
  experimental: {
    agentUpgrade: "security",
  },
};

export default nextConfig;

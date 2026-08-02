import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/**
 * `app/api/pricing/route.ts` (OCL-016) is the one sanctioned write path (D2/D3)
 * and may additionally export `PUT`. Every other route may only ever export
 * read-only HTTP methods.
 */
const ALLOWED_EXTRA: Record<string, string[]> = {
  "app/api/pricing/route.ts": ["PUT"],
};
const DEFAULT_ALLOWED = ["GET", "HEAD", "OPTIONS"];

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value);
}

const HTTP_EXPORT_RE = /export\s+(?:default\s+)?(?:async\s+function|function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
// `export { name }` / `export { name as ALIAS }` — Next.js binds a route handler by the
// *final* exported name, so `export { handler as POST }` is a real POST handler even
// though nothing named `POST` was ever declared with `function`/`const` (code-review-2026-08-02.md M5).
const HTTP_REEXPORT_BLOCK_RE = /export\s*\{([^}]*)\}/g;

function findHttpExports(source: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  HTTP_EXPORT_RE.lastIndex = 0;
  while ((match = HTTP_EXPORT_RE.exec(source))) {
    const method = match[1];
    if (method !== undefined) found.add(method);
  }

  HTTP_REEXPORT_BLOCK_RE.lastIndex = 0;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = HTTP_REEXPORT_BLOCK_RE.exec(source))) {
    for (const entry of (blockMatch[1] ?? "").split(",")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const asMatch = /^\S+\s+as\s+(\S+)$/.exec(trimmed);
      const exportedName = asMatch?.[1] ?? trimmed;
      if (isHttpMethod(exportedName)) found.add(exportedName);
    }
  }

  return [...found];
}

/** Exported so its detection behaviour can be proven directly, without needing to write and delete scratch route files in the real `app/api/` tree. */
export function disallowedExports(relPath: string, source: string): string[] {
  const allowed = [...DEFAULT_ALLOWED, ...(ALLOWED_EXTRA[relPath] ?? [])];
  return findHttpExports(source).filter((method) => !allowed.includes(method));
}

function walkRouteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkRouteFiles(full, out);
    } else if (entry === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

describe("app/api route handlers", () => {
  it("no route exports a disallowed HTTP method (GET/HEAD/OPTIONS only, except PUT on app/api/pricing/route.ts)", () => {
    const apiDir = join(ROOT, "app/api");
    if (!existsSync(apiDir)) {
      // No API routes exist yet — nothing to check. This test starts enforcing
      // the moment the first `app/api/**/route.ts` lands.
      return;
    }

    const violations: string[] = [];
    for (const file of walkRouteFiles(apiDir)) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const source = readFileSync(file, "utf8");
      const bad = disallowedExports(rel, source);
      if (bad.length > 0) {
        violations.push(`${rel}: exports disallowed method(s) ${bad.join(", ")}`);
      }
    }

    expect(violations).toEqual([]);
  });
});

/**
 * Proves the checker above actually detects violations — a permanent,
 * regression-proof test rather than a manual scratch-file-then-revert, which
 * would leave no lasting evidence the detection logic works.
 */
describe("disallowedExports (detection proof)", () => {
  it("flags a POST export on an ordinary route file", () => {
    const source = "export async function POST() {}\nexport async function GET() {}\n";
    expect(disallowedExports("app/api/sessions/route.ts", source)).toEqual(["POST"]);
  });

  it("allows a GET-only route", () => {
    const source = "export async function GET() {}\n";
    expect(disallowedExports("app/api/sessions/route.ts", source)).toEqual([]);
  });

  it("flags DELETE and PATCH together on an ordinary route file", () => {
    const source = "export async function DELETE() {}\nexport const PATCH = async () => {};\n";
    expect(disallowedExports("app/api/projects/[id]/route.ts", source).sort()).toEqual(["DELETE", "PATCH"]);
  });

  it("allows PUT specifically on app/api/pricing/route.ts, the sanctioned write path", () => {
    const source = "export async function GET() {}\nexport async function PUT() {}\n";
    expect(disallowedExports("app/api/pricing/route.ts", source)).toEqual([]);
  });

  it("still flags POST/DELETE on app/api/pricing/route.ts — only PUT is sanctioned there", () => {
    const source = "export async function DELETE() {}\n";
    expect(disallowedExports("app/api/pricing/route.ts", source)).toEqual(["DELETE"]);
  });

  it("flags a re-exported handler aliased to an HTTP method name, not just direct function/const declarations", () => {
    const source = "async function handler() {}\nexport { handler as POST };\n";
    expect(disallowedExports("app/api/sessions/route.ts", source)).toEqual(["POST"]);
  });

  it("flags a direct named re-export with no alias", () => {
    const source = "async function POST() {}\nexport { POST };\n";
    expect(disallowedExports("app/api/sessions/route.ts", source)).toEqual(["POST"]);
  });

  it("does not flag a POST-named local binding re-exported under a safe alias — Next.js binds by the final exported name", () => {
    const source = "async function POST() {}\nexport { POST as internalPostHelper };\n";
    expect(disallowedExports("app/api/sessions/route.ts", source)).toEqual([]);
  });
});

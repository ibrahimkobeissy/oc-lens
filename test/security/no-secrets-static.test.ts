import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "lib", "components", "types", "bin", "hooks", "design-system"];

/**
 * `lib/db/connection.ts` legitimately names the four denylisted tables in its
 * `DENYLISTED_TABLES` constant — that's the enforcement point, not a leak.
 * `lib/db/__tests__/connection.test.ts` legitimately names all four again,
 * one per `it.each` case, to prove the denylist actually rejects each of
 * them. Nothing else outside these two files (and `test/security/` itself,
 * excluded from scanning below since `test/` isn't one of SCAN_DIRS) may
 * name these strings.
 */
const ALLOWLISTED_FILES = new Set(["lib/db/connection.ts", "lib/db/__tests__/connection.test.ts"]);

/**
 * Exact substrings stripped from source before scanning — legitimate,
 * non-leaking uses of an otherwise-forbidden term (e.g. `types/oc.ts`
 * documenting a field as "credential-free"). Unlike `ALLOWLISTED_FILES`,
 * this doesn't exempt the rest of the file from scanning.
 */
const ALLOWLISTED_PHRASES = ["credential-free"];

const FORBIDDEN = [
  "auth.json",
  "account.json",
  "access_token",
  "refresh_token",
  "account_state",
  "control_account",
  "credential",
  "account",
];

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkSourceFiles(full, out);
    } else if (/\.(ts|tsx|js)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("no secret-adjacent string appears outside the denylist constant", () => {
  it("scans app/, lib/, components/, types/, bin/, hooks/, design-system/ for auth.json, account.json, access_token, refresh_token, and the four denylisted table names", () => {
    const violations: string[] = [];

    for (const scanDir of SCAN_DIRS) {
      const dirPath = join(ROOT, scanDir);
      if (!existsSync(dirPath)) continue; // e.g. app/api/ doesn't exist yet

      for (const file of walkSourceFiles(dirPath)) {
        const rel = relative(ROOT, file).replace(/\\/g, "/");
        if (ALLOWLISTED_FILES.has(rel)) continue;

        let source = readFileSync(file, "utf8");
        for (const phrase of ALLOWLISTED_PHRASES) source = source.replaceAll(phrase, "");
        for (const term of FORBIDDEN) {
          const pattern = new RegExp(`\\b${term.replace(/\./g, "\\.")}\\b`, "i");
          if (pattern.test(source)) {
            violations.push(`${rel}: contains "${term}"`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

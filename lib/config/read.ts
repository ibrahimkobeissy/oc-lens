import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type JsonObject = Record<string, unknown>;

export interface ConfigReadOptions {
  /** Test-only isolation override. Production callers omit it. */
  configHome?: string;
  /** Test-only isolation override used when XDG_CONFIG_HOME is absent. */
  homeDir?: string;
  /** Worktrees obtained from the read-only project table. */
  projectWorktrees?: readonly string[];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripJsonComments(source: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (lineComment) {
      if (char === "\n" || char === "\r") {
        lineComment = false;
        output += char;
      } else {
        output += " ";
      }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        output += "  ";
        blockComment = false;
        index += 1;
      } else {
        output += char === "\n" || char === "\r" ? char : " ";
      }
      continue;
    }
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      lineComment = true;
      output += "  ";
      index += 1;
    } else if (char === "/" && next === "*") {
      blockComment = true;
      output += "  ";
      index += 1;
    } else {
      output += char;
    }
  }
  return output;
}

function stripTrailingCommas(source: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ",") {
      let lookahead = index + 1;
      while (/\s/.test(source[lookahead] ?? "")) lookahead += 1;
      if (source[lookahead] === "}" || source[lookahead] === "]") continue;
    }
    output += char;
  }
  return output;
}

/** Parse JSONC without executing code or accepting non-JSON syntax. */
export function parseJsonc(source: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(stripTrailingCommas(stripJsonComments(source.replace(/^\uFEFF/, ""))));
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readFile(path: string): JsonObject | null {
  if (!fs.existsSync(path)) return null;
  const stat = fs.lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) return null;
  return parseJsonc(fs.readFileSync(path, "utf-8"));
}

function mergeObjects(base: JsonObject, override: JsonObject): JsonObject {
  const merged: JsonObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const previous = merged[key];
    merged[key] = isObject(previous) && isObject(value) ? mergeObjects(previous, value) : value;
  }
  return merged;
}

function globalConfigPath(options: ConfigReadOptions): string {
  const configHome = options.configHome ?? process.env.XDG_CONFIG_HOME;
  const base = configHome && configHome.length > 0 ? configHome : join(options.homeDir ?? homedir(), ".config");
  return join(base, "opencode", "opencode.jsonc");
}

/**
 * Reads only the fixed opencode config filenames. It never scans the config
 * directory, so no sibling files are candidates. Project files are layered
 * in sorted worktree order to make the single response stable.
 */
export function readOpencodeConfig(options: ConfigReadOptions = {}): JsonObject | null {
  const paths = [
    globalConfigPath(options),
    ...[...new Set(options.projectWorktrees ?? [])]
      .filter((worktree) => worktree.length > 0 && worktree !== "/")
      .sort()
      .flatMap((worktree) => [join(worktree, "opencode.jsonc"), join(worktree, "opencode.json")]),
  ];

  let combined: JsonObject | null = null;
  for (const path of paths) {
    const parsed = readFile(path);
    if (parsed) combined = mergeObjects(combined ?? {}, parsed);
  }
  return combined;
}

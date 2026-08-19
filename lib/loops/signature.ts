import { createHash } from "node:crypto";

/**
 * Call signatures for loop detection.
 *
 * Two rules here are load-bearing and deliberate:
 *
 * 1. **Hash, never keep.** `part.data.state.input` holds `bash` command lines and
 *    whole file contents. Only a hash may travel to the client, so nothing in
 *    this module returns raw input.
 * 2. **Shape-agnostic.** The signature is built from whatever keys the input
 *    happens to carry — never a per-tool key list. opencode records different
 *    inputs for different tools and versions (the test fixture has six tool
 *    types that record none at all), so hardcoding `grep -> pattern` would
 *    silently produce wrong answers wherever the guess was wrong.
 */

/** Longest input we will hash, in JSON characters. Beyond this the tail is dropped. */
const MAX_CANON_CHARS = 64_000;

/**
 * Deterministic JSON with object keys sorted at every depth, so `{a,b}` and
 * `{b,a}` — the same call — cannot produce two different signatures.
 */
export function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalise(record[key])}`)
    .join(",")}}`;
}

/**
 * True when opencode recorded enough to compare this call against another.
 *
 * An absent or empty input is *unsignaturable*, not "equal to every other empty
 * one": four `glob` calls that recorded nothing look identical but may have
 * searched four different patterns. Reporting them as a loop would invent a
 * finding, so they are excluded and counted separately instead.
 */
export function isSignaturable(input: unknown): input is Record<string, unknown> {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    Object.keys(input as Record<string, unknown>).length > 0
  );
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * `tool:hash` for a comparable call, or `null` when the call recorded no input.
 * Callers must treat `null` as "cannot judge", never as a bucket key.
 */
export function callSignature(tool: string, input: unknown): string | null {
  if (!isSignaturable(input)) return null;
  return `${tool}:${digest(canonicalise(input).slice(0, MAX_CANON_CHARS))}`;
}

/**
 * Hash of a mutation's *content* alone, used to tell rewriting a file with new
 * text (progress) from restoring text it already had (oscillation). `null` when
 * the tool call carries no string content to compare.
 */
export function contentSignature(input: unknown): string | null {
  if (!isSignaturable(input)) return null;
  const content = input["content"];
  if (typeof content !== "string") return null;
  return digest(content.slice(0, MAX_CANON_CHARS));
}

/** The mutation target this call writes to, or `null` if it is not a path-taking write. */
export function targetPath(input: unknown): string | null {
  if (!isSignaturable(input)) return null;
  const filePath = input["filePath"];
  return typeof filePath === "string" && filePath.length > 0 ? filePath : null;
}

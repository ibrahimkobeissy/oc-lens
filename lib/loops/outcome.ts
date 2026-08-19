/**
 * Did a tool call actually fail?
 *
 * `state.status` is not enough. opencode records a shell command that exited
 * non-zero as `status: "completed"` — the *tool* ran fine, the command inside it
 * did not. A build retried until it passes is therefore invisible to a
 * status-only check, and that is the single case the maintainer most wants to
 * see.
 *
 * The evidence is `state.metadata.exit`, verified 2026-08-20 against a real
 * opencode database: every `bash` call carried a numeric `exit`. Tools that
 * record no exit code are left alone rather than guessed at — no output-text
 * heuristics, which would misfire on any command that prints the word "error".
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The process exit code a tool recorded, or `null` when it recorded none.
 *
 * Reads the raw part payload because `state.metadata` is deliberately opaque in
 * `OcPartToolData` — its shape is per tool, so only this one verified field is
 * narrowed, and only where it is actually a finite number.
 */
export function toolExitCode(rawPartData: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPartData);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const state = parsed["state"];
  if (!isRecord(state)) return null;
  const metadata = state["metadata"];
  if (!isRecord(metadata)) return null;
  const exit = metadata["exit"];
  return typeof exit === "number" && Number.isFinite(exit) ? exit : null;
}

/**
 * A call counts as failed when the tool itself errored, or when it reported a
 * non-zero exit code. A `null` exit code is not evidence of success — it means
 * the tool records no exit code at all — so it falls back to the status.
 */
export function isFailedCall(status: string, exitCode: number | null): boolean {
  return status === "error" || (exitCode !== null && exitCode !== 0);
}

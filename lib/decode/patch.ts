import type { OcPartPatchData } from "@/types/oc";

/**
 * Decodes `part.data` for a confirmed `patch` part (data-model §5, confirmed
 * live against a real opencode.db on 2026-08-02). Returns `null` if `hash` or
 * `files` — the only two fields ever actually observed — is missing or the
 * wrong type, so the caller falls back to the `unknown` part rather than
 * fabricating a hash or file list that was never really seen.
 */
export function decodePatchData(obj: Record<string, unknown>): OcPartPatchData | null {
  const { hash, files } = obj;
  if (typeof hash !== "string" || !Array.isArray(files) || !files.every((file) => typeof file === "string")) {
    return null;
  }
  return { type: "patch", hash, files: files as string[] };
}

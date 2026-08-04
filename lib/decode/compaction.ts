import type { OcPartCompactionData } from "@/types/oc";

/**
 * Decodes `part.data` for a confirmed `compaction` part (data-model §5,
 * confirmed live against a real opencode.db on 2026-08-02). Returns `null`
 * if `auto`/`overflow` — the two fields required on every real row ever
 * observed — is missing or the wrong type, so the caller falls back to the
 * `unknown` part rather than fabricating a boolean that was never really
 * seen. `tail_start_id` is optional: confirmed live 2026-08-03 on a real row
 * with no `tail_start_id` key at all, so its absence decodes to `null`
 * rather than rejecting the whole part — only a *present but wrong-typed*
 * `tail_start_id` is still treated as malformed.
 */
export function decodeCompactionData(obj: Record<string, unknown>): OcPartCompactionData | null {
  const { auto, overflow, tail_start_id: tailStartId } = obj;
  if (typeof auto !== "boolean" || typeof overflow !== "boolean") {
    return null;
  }
  if (tailStartId !== undefined && tailStartId !== null && typeof tailStartId !== "string") {
    return null;
  }
  return { type: "compaction", auto, overflow, tailStartId: tailStartId ?? null };
}

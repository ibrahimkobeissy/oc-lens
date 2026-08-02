import type { OcPartCompactionData } from "@/types/oc";

/**
 * Decodes `part.data` for a confirmed `compaction` part (data-model §5,
 * confirmed live against a real opencode.db on 2026-08-02). Returns `null`
 * if `auto`/`overflow`/`tail_start_id` — the only three fields ever actually
 * observed — is missing or the wrong type, so the caller falls back to the
 * `unknown` part rather than fabricating a boolean or an id that was never
 * really seen.
 */
export function decodeCompactionData(obj: Record<string, unknown>): OcPartCompactionData | null {
  const { auto, overflow, tail_start_id: tailStartId } = obj;
  if (typeof auto !== "boolean" || typeof overflow !== "boolean" || typeof tailStartId !== "string") {
    return null;
  }
  return { type: "compaction", auto, overflow, tailStartId };
}

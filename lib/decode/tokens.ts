import type { OcTokens } from "@/types/oc";
import { asNumber, asRecord } from "./json";

/**
 * Decodes the `tokens.{input,output,reasoning,cache.{read,write}}` shape
 * shared by `message.data` and `part.data` (step-finish). Reads cache figures
 * from the nested `tokens.cache.read`/`.write` path, never a flat field.
 * `null` input (e.g. a user message with no usage) yields `null`, not zeros.
 */
export function decodeTokens(raw: unknown): OcTokens | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const cache = asRecord(obj.cache);
  return {
    input: asNumber(obj.input) ?? 0,
    output: asNumber(obj.output) ?? 0,
    reasoning: asNumber(obj.reasoning) ?? 0,
    cacheRead: asNumber(cache?.read) ?? 0,
    cacheWrite: asNumber(cache?.write) ?? 0,
  };
}

import type { OcTokens } from "@/types/oc";
import { asRecord } from "./json";

function validToken(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

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
  if (
    !validToken(obj.input) ||
    !validToken(obj.output) ||
    !validToken(obj.reasoning) ||
    !cache ||
    !validToken(cache.read) ||
    !validToken(cache.write)
  ) return null;
  return {
    input: obj.input,
    output: obj.output,
    reasoning: obj.reasoning,
    cacheRead: cache.read,
    cacheWrite: cache.write,
  };
}

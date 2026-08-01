import type { OcWarning } from "@/types/oc";

export interface Decoded<T> {
  value: T;
  warnings: OcWarning[];
}

export function warning(code: string, message: string, count = 1): OcWarning {
  return { code, message, count };
}

/** Aggregates warnings across a batch by `code`, summing counts, so "3 unknown types in 100 parts" is one warning with count 3, not three. */
export function mergeWarnings(warningsList: OcWarning[][]): OcWarning[] {
  const byCode = new Map<string, OcWarning>();
  for (const warnings of warningsList) {
    for (const w of warnings) {
      const existing = byCode.get(w.code);
      if (existing) {
        existing.count += w.count;
      } else {
        byCode.set(w.code, { ...w });
      }
    }
  }
  return Array.from(byCode.values());
}

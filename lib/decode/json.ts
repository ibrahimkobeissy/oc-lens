/** Parses a nullable SQLite TEXT/JSON column without ever throwing. */
export function safeJsonParse(raw: string | null): { ok: true; value: unknown } | { ok: false } {
  if (raw === null || raw === "") {
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

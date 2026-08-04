import type { OcSessionModel } from "@/types/oc";
import { asRecord, asString, safeJsonParse } from "./json";
import { type Decoded, warning } from "./warnings";

/**
 * Decodes the `session.model` JSON-blob column. `null`/empty is a legitimate NULL
 * column, not a warning. `variant` is optional — confirmed live 2026-08-03 on a real
 * custom (non-catalog) provider row, `{"id":"ClovisLLM","providerID":"litellm"}`, with
 * no `variant` key at all — so its absence decodes to `null` rather than rejecting the
 * whole model; only a missing/wrong-typed `id` or `providerID` is still malformed.
 */
export function decodeSessionModel(raw: string | null): Decoded<OcSessionModel | null> {
  if (raw === null || raw === "") {
    return { value: null, warnings: [] };
  }

  const parsed = safeJsonParse(raw);
  if (!parsed.ok) {
    return { value: null, warnings: [warning("malformed-session-model", "session.model was not valid JSON")] };
  }

  const obj = asRecord(parsed.value);
  const id = asString(obj?.id);
  const providerID = asString(obj?.providerID);
  const variant = asString(obj?.variant);
  if (!obj || id === null || providerID === null) {
    return { value: null, warnings: [warning("malformed-session-model", "session.model did not match the expected {id,providerID,variant} shape")] };
  }

  return { value: { id, providerID, variant }, warnings: [] };
}

export interface DecodedPermission {
  permission: string;
  pattern: string;
  action: string;
}

/** Decodes the `session.permission` JSON-array column. Not consumed elsewhere in v1 (data-model §2) — decoded defensively for completeness. */
export function decodeSessionPermission(raw: string | null): Decoded<DecodedPermission[] | null> {
  if (raw === null || raw === "") {
    return { value: null, warnings: [] };
  }

  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !Array.isArray(parsed.value)) {
    return { value: null, warnings: [warning("malformed-session-permission", "session.permission was not a valid JSON array")] };
  }

  const value: DecodedPermission[] = [];
  let malformedItems = 0;
  for (const item of parsed.value) {
    const obj = asRecord(item);
    const permission = asString(obj?.permission);
    const pattern = asString(obj?.pattern);
    const action = asString(obj?.action);
    if (obj && permission !== null && pattern !== null && action !== null) {
      value.push({ permission, pattern, action });
    } else {
      malformedItems += 1;
    }
  }

  const warnings = malformedItems > 0 ? [warning("malformed-session-permission-item", "A session.permission entry did not match the expected shape", malformedItems)] : [];
  return { value, warnings };
}

const PLACEHOLDER_TITLE_PATTERN = /^New session - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Matches opencode's generated placeholder title, e.g. "New session - 2026-07-05T00:00:14.641Z" (data-model §2). */
export function isPlaceholderTitle(title: string): boolean {
  return PLACEHOLDER_TITLE_PATTERN.test(title);
}

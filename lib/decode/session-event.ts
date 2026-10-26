import type { OcPartSessionEventData, SessionEventKind } from "@/types/oc";
import { asNumber, asRecord, asString, safeJsonParse } from "./json";
import { type Decoded, warning } from "./warnings";

const KNOWN_KINDS: readonly SessionEventKind[] = ["system", "idle", "agent-switched", "model-switched", "location-switched", "skill", "shell"];

function modelLabel(raw: unknown): string | null {
  const model = asRecord(raw);
  const id = asString(model?.id);
  const providerID = asString(model?.providerID);
  if (!id) return null;
  return providerID ? `${providerID}/${id}` : id;
}

function errorMessage(raw: unknown): string | null {
  return asString(asRecord(raw)?.message);
}

/**
 * Decodes one opencode 2.x lifecycle record (`session_message` rows that are not
 * user/assistant/compaction turns — data-model §8). `system` and `idle` are
 * verified against a real 2.1.4 database; the remaining known kinds follow the
 * upstream `session-message.ts` schema only, so every field is read
 * defensively and a missing one degrades the summary, never the record.
 */
export function decodeSessionEvent(rawKind: string, raw: string | null): Decoded<OcPartSessionEventData> {
  const kind: SessionEventKind = (KNOWN_KINDS as readonly string[]).includes(rawKind) ? rawKind as SessionEventKind : "unknown";
  const parsed = safeJsonParse(raw);
  const data = parsed.ok ? asRecord(parsed.value) : null;
  const base: OcPartSessionEventData = { type: "session-event", kind, rawKind, summary: rawKind, detail: null, outcome: null, exitCode: null };
  const warnings = [];
  if (!data) warnings.push(warning("malformed-session-event", "A session_message lifecycle record had missing or invalid JSON data"));
  if (kind === "unknown") warnings.push(warning("unknown-session-event", `Unrecognised session_message.type: ${rawKind || "(missing)"}`));
  if (!data) return { value: { ...base, summary: `Unreadable ${rawKind || "session"} record` }, warnings };

  switch (kind) {
    case "system":
      return { value: { ...base, summary: asString(data.description) ?? "System context update", detail: asString(data.text) }, warnings };
    case "idle": {
      const outcome = asString(data.outcome);
      return { value: { ...base, summary: `Session idle${outcome ? ` · ${outcome}` : ""}`, outcome, detail: errorMessage(data.error) }, warnings };
    }
    case "agent-switched": {
      const agent = asString(data.agent);
      const previous = asString(data.previous);
      return { value: { ...base, summary: `Agent switched to ${agent ?? "unknown"}${previous ? ` (from ${previous})` : ""}` }, warnings };
    }
    case "model-switched": {
      const model = modelLabel(data.model);
      const previous = modelLabel(data.previous);
      return { value: { ...base, summary: `Model switched to ${model ?? "unknown"}${previous ? ` (from ${previous})` : ""}` }, warnings };
    }
    case "location-switched":
      return { value: { ...base, summary: "Working location changed", detail: asString(data.subpath) }, warnings };
    case "skill":
      return { value: { ...base, summary: `Skill loaded: ${asString(data.name) ?? asString(data.skill) ?? "unknown"}`, detail: asString(data.text) }, warnings };
    case "shell": {
      const command = asString(data.command);
      return {
        value: {
          ...base,
          summary: command ? `Shell: ${command}` : "Shell command",
          outcome: asString(data.status),
          exitCode: asNumber(data.exit),
          detail: asString(data.output),
        },
        warnings,
      };
    }
    default:
      return { value: { ...base, summary: `Unrecognised session record: ${rawKind || "(missing)"}` }, warnings };
  }
}

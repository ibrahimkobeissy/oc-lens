import type { OcPartData, OcWarning, ToolStatus } from "@/types/oc";
import { decodeCompactionData } from "./compaction";
import { asNumber, asRecord, asString, safeJsonParse } from "./json";
import { decodeTokens } from "./tokens";
import { type Decoded, mergeWarnings, warning } from "./warnings";

const KNOWN_TOOL_STATUSES = ["completed", "error", "pending", "running"] as const;

function decodeToolStatus(raw: unknown): Decoded<ToolStatus> {
  if (typeof raw === "string" && (KNOWN_TOOL_STATUSES as readonly string[]).includes(raw)) {
    return { value: raw as ToolStatus, warnings: [] };
  }
  return {
    value: "unknown",
    warnings: [warning("unknown-tool-status", "Tool parts had an unrecognised or missing state.status; rendered as unknown")],
  };
}

function unknownPart(rawType: string, raw: unknown, extraWarning?: OcWarning): Decoded<OcPartData> {
  const warnings = [warning("unknown-part-type", `Unrecognised part.data.type: ${rawType || "(missing)"}`)];
  if (extraWarning) warnings.push(extraWarning);
  return { value: { type: "unknown", rawType, raw }, warnings };
}

/**
 * Decodes `part.data` into the OCL-010 discriminated union (data-model §5).
 * `patch`/`file`/`agent`/`snapshot` are still ⚠️ UNVERIFIED — not decoded
 * here; they fall through to the `unknown` variant until OCL-103 adds its
 * verified shape. `compaction` was confirmed live on 2026-08-02.
 */
export function decodePartData(raw: string | null): Decoded<OcPartData> {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok) {
    return unknownPart("", null, warning("malformed-part-data", "part.data was missing or not valid JSON"));
  }

  const obj = asRecord(parsed.value);
  if (!obj) {
    return unknownPart("", parsed.value, warning("malformed-part-data", "part.data was not a JSON object"));
  }

  const type = obj.type;

  switch (type) {
    case "text":
      return { value: { type: "text", text: asString(obj.text) ?? "" }, warnings: [] };

    case "reasoning": {
      const time = asRecord(obj.time);
      return {
        value: {
          type: "reasoning",
          text: asString(obj.text) ?? "",
          timeStart: asNumber(time?.start),
          timeEnd: asNumber(time?.end),
        },
        warnings: [],
      };
    }

    case "step-start":
      return { value: { type: "step-start" }, warnings: [] };

    case "step-finish":
      return {
        value: {
          type: "step-finish",
          reason: asString(obj.reason),
          cost: asNumber(obj.cost),
          tokens: decodeTokens(obj.tokens),
        },
        warnings: [],
      };

    case "tool": {
      const state = asRecord(obj.state);
      const time = asRecord(state?.time);
      const status = decodeToolStatus(state?.status);
      return {
        value: {
          type: "tool",
          tool: asString(obj.tool) ?? "",
          callId: asString(obj.callID) ?? "",
          status: status.value,
          input: state?.input,
          output: asString(state?.output) ?? asString(state?.error),
          title: asString(state?.title),
          timeStart: asNumber(time?.start),
          timeEnd: asNumber(time?.end),
        },
        warnings: status.warnings,
      };
    }

    case "compaction": {
      const compaction = decodeCompactionData(obj);
      return compaction
        ? { value: compaction, warnings: [] }
        : unknownPart("compaction", parsed.value, warning("malformed-compaction", "part.data.type was 'compaction' but auto/overflow/tail_start_id were missing or the wrong type"));
    }

    default:
      return unknownPart(typeof type === "string" ? type : "", parsed.value);
  }
}

/** Batch helper: decodes a list of `part.data` blobs and aggregates warnings by code (see mergeWarnings). */
export function decodeParts(rawList: Array<string | null>): { values: OcPartData[]; warnings: OcWarning[] } {
  const values: OcPartData[] = [];
  const warningsList: OcWarning[][] = [];
  for (const raw of rawList) {
    const { value, warnings } = decodePartData(raw);
    values.push(value);
    warningsList.push(warnings);
  }
  return { values, warnings: mergeWarnings(warningsList) };
}

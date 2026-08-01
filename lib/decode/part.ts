import type { OcPartData, OcWarning, ToolStatus } from "@/types/oc";
import { asNumber, asRecord, asString, safeJsonParse } from "./json";
import { decodeTokens } from "./tokens";
import { type Decoded, mergeWarnings, warning } from "./warnings";

const KNOWN_TOOL_STATUSES: ToolStatus[] = ["completed", "error", "pending", "running"];

// ToolStatus (frozen in types/oc.ts) has no `unknown` sentinel; an
// unrecognised value falls back to "pending" as the closest honest reading
// ("we don't yet know the outcome"), rather than guessing "completed"/"error".
function decodeToolStatus(raw: unknown): ToolStatus {
  return typeof raw === "string" && (KNOWN_TOOL_STATUSES as string[]).includes(raw) ? (raw as ToolStatus) : "pending";
}

function unknownPart(rawType: string, raw: unknown, extraWarning?: OcWarning): Decoded<OcPartData> {
  const warnings = [warning("unknown-part-type", `Unrecognised part.data.type: ${rawType || "(missing)"}`)];
  if (extraWarning) warnings.push(extraWarning);
  return { value: { type: "unknown", rawType, raw }, warnings };
}

/**
 * Decodes `part.data` into the OCL-010 discriminated union (data-model §5).
 * `patch`/`compaction`/`file`/`agent`/`snapshot` are ⚠️ UNVERIFIED — not
 * decoded here; they fall through to the `unknown` variant until OCL-055/
 * OCL-103 add their verified shape.
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
      return {
        value: {
          type: "tool",
          tool: asString(obj.tool) ?? "",
          callId: asString(obj.callID) ?? "",
          status: decodeToolStatus(state?.status),
          input: state?.input,
          output: asString(state?.output),
          title: asString(state?.title),
          timeStart: asNumber(time?.start),
          timeEnd: asNumber(time?.end),
        },
        warnings: [],
      };
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

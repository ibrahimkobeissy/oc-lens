import type { MessageRole, OcMessageData, OcWarning } from "@/types/oc";
import { asNumber, asRecord, asString, safeJsonParse } from "./json";
import { decodeTokens } from "./tokens";
import { type Decoded, warning } from "./warnings";

const EMPTY_MESSAGE_DATA: OcMessageData = {
  role: "unknown",
  agent: null,
  mode: null,
  modelID: null,
  providerID: null,
  tokens: null,
  cost: null,
  timeCreated: null,
  timeCompleted: null,
  parentId: null,
  finish: null,
};

function decodeRole(raw: unknown): MessageRole {
  return raw === "user" || raw === "assistant" ? raw : "unknown";
}

/**
 * Decodes `message.data`. Handles both observed shapes (data-model §4): the
 * assistant shape carries top-level `modelID`/`providerID`; the user shape
 * carries them nested under `model.{providerID,modelID}` instead — this falls
 * back to the nested form when the top-level fields are absent.
 */
export function decodeMessageData(raw: string | null): Decoded<OcMessageData> {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok) {
    return { value: EMPTY_MESSAGE_DATA, warnings: [warning("malformed-message-data", "message.data was missing or not valid JSON")] };
  }

  const obj = asRecord(parsed.value);
  if (!obj) {
    return { value: EMPTY_MESSAGE_DATA, warnings: [warning("malformed-message-data", "message.data was not a JSON object")] };
  }

  const warnings: OcWarning[] = [];
  if (obj.role !== "user" && obj.role !== "assistant") {
    warnings.push(warning("unknown-message-role", `Unrecognised message.data.role: ${String(obj.role)}`));
  }

  const nestedModel = asRecord(obj.model);
  const modelID = asString(obj.modelID) ?? asString(nestedModel?.modelID) ?? null;
  const providerID = asString(obj.providerID) ?? asString(nestedModel?.providerID) ?? null;

  const time = asRecord(obj.time);

  const value: OcMessageData = {
    role: decodeRole(obj.role),
    agent: asString(obj.agent),
    mode: asString(obj.mode),
    modelID,
    providerID,
    tokens: decodeTokens(obj.tokens),
    cost: asNumber(obj.cost),
    timeCreated: asNumber(time?.created),
    timeCompleted: asNumber(time?.completed),
    parentId: asString(obj.parentID),
    finish: asString(obj.finish),
  };

  return { value, warnings };
}

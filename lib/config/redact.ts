import type { RedactedConfig, RedactedConfigValue } from "@/types/oc";

const REDACTED = "[redacted]" as const;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Preserve container shape while replacing every leaf in an unknown subtree. */
function redactUnknown(value: unknown): RedactedConfigValue {
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactUnknown(child)]));
  }
  return REDACTED;
}

function safePrimitive(value: unknown): RedactedConfigValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null
    ? value
    : redactUnknown(value);
}

function redactPermission(value: unknown): RedactedConfigValue {
  if (value === "allow" || value === "ask" || value === "deny") return value;
  if (Array.isArray(value)) return value.map(redactPermission);
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactPermission(child)]));
  }
  return REDACTED;
}

function redactKeybinds(value: unknown): RedactedConfigValue {
  if (!isObject(value)) return redactUnknown(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, binding]) => [key, typeof binding === "string" ? binding : redactUnknown(binding)]),
  );
}

const SAFE_AGENT_FIELDS = new Set([
  "color",
  "description",
  "disable",
  "hidden",
  "mode",
  "model",
  "steps",
  "temperature",
  "top_p",
]);

function redactAgentDefinition(value: unknown): RedactedConfigValue {
  if (!isObject(value)) return redactUnknown(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key === "permission") return [key, redactPermission(child)];
      return [key, SAFE_AGENT_FIELDS.has(key) ? safePrimitive(child) : redactUnknown(child)];
    }),
  );
}

function redactAgents(value: unknown): RedactedConfigValue {
  if (!isObject(value)) return redactUnknown(value);
  return Object.fromEntries(Object.entries(value).map(([name, definition]) => [name, redactAgentDefinition(definition)]));
}

function redactMcp(value: unknown): RedactedConfigValue {
  if (!isObject(value)) return redactUnknown(value);
  return Object.fromEntries(
    Object.entries(value).map(([name, definition]) => {
      if (!isObject(definition)) return [name, redactUnknown(definition)];
      return [
        name,
        Object.fromEntries(
          Object.entries(definition).map(([key, child]) => [
            key,
            key === "type" && typeof child === "string" ? child : redactUnknown(child),
          ]),
        ),
      ];
    }),
  );
}

function redactPlugins(value: unknown): RedactedConfigValue {
  if (!Array.isArray(value)) return redactUnknown(value);
  return value.map((plugin) => (typeof plugin === "string" ? plugin : redactUnknown(plugin)));
}

function redactRaw(config: JsonObject): Record<string, RedactedConfigValue> {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => {
      switch (key) {
        case "agent":
          return [key, redactAgents(value)];
        case "mcp":
          return [key, redactMcp(value)];
        case "plugin":
          return [key, redactPlugins(value)];
        case "keybinds":
          return [key, redactKeybinds(value)];
        case "permission":
          return [key, redactPermission(value)];
        case "model":
        case "small_model":
        case "default_agent":
        case "theme":
          return [key, safePrimitive(value)];
        default:
          return [key, redactUnknown(value)];
      }
    }),
  );
}

function agentNames(config: JsonObject): string[] {
  return isObject(config.agent) ? Object.keys(config.agent).sort() : [];
}

function mcpServers(config: JsonObject): Array<{ name: string; transport: string }> {
  if (!isObject(config.mcp)) return [];
  return Object.entries(config.mcp)
    .map(([name, definition]) => ({
      name,
      transport: isObject(definition) && typeof definition.type === "string" ? definition.type : "unknown",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function pluginNames(config: JsonObject): string[] {
  if (!Array.isArray(config.plugin)) return [];
  return config.plugin.filter((plugin): plugin is string => typeof plugin === "string").sort();
}

/**
 * Converts parsed opencode configuration into the frozen safe contract. The
 * implementation is intentionally an allowlist: adding a new config field to
 * opencode cannot make it visible here without an explicit code change.
 */
export function redactConfig(config: JsonObject): RedactedConfig {
  return {
    agents: agentNames(config),
    mcpServers: mcpServers(config),
    plugins: pluginNames(config),
    raw: redactRaw(config),
  };
}

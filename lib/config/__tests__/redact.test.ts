import { describe, expect, it } from "vitest";
import { redactConfig } from "../redact";

describe("redactConfig", () => {
  it("redacts apiKey values at depths 1 and 3 and inside an array", () => {
    const redacted = redactConfig({
      apiKey: "sk-depth-1",
      agent: {
        build: {
          description: "Build agent",
          unknown: { nested: { apiKey: "sk-depth-3" } },
        },
      },
      mystery: [{ apiKey: "sk-array" }],
    });

    expect(redacted.raw.apiKey).toBe("[redacted]");
    expect(redacted.raw.agent).toEqual({
      build: {
        description: "Build agent",
        unknown: { nested: { apiKey: "[redacted]" } },
      },
    });
    expect(redacted.raw.mystery).toEqual([{ apiKey: "[redacted]" }]);
    expect(JSON.stringify(redacted)).not.toContain("sk-");
  });

  it("keeps only explicitly safe config data and preserves unknown-key shape", () => {
    const redacted = redactConfig({
      model: "openai/gpt-5",
      theme: "oc-dark",
      plugin: ["opencode-plugin"],
      keybinds: { session_new: "ctrl+n" },
      permission: { bash: "ask", edit: { "*.ts": "allow" } },
      agent: { build: { mode: "primary", model: "openai/gpt-5", prompt: "private prompt" } },
      mcp: {
        docs: { type: "remote", url: "https://example.invalid", headers: { Authorization: "secret" } },
      },
      futureFeature: { token: "unknown-secret", enabled: true },
    });

    expect(redacted.agents).toEqual(["build"]);
    expect(redacted.plugins).toEqual(["opencode-plugin"]);
    expect(redacted.mcpServers).toEqual([{ name: "docs", transport: "remote" }]);
    expect(redacted.raw).toMatchObject({
      model: "openai/gpt-5",
      theme: "oc-dark",
      plugin: ["opencode-plugin"],
      keybinds: { session_new: "ctrl+n" },
      permission: { bash: "ask", edit: { "*.ts": "allow" } },
      agent: { build: { mode: "primary", model: "openai/gpt-5", prompt: "[redacted]" } },
      mcp: {
        docs: {
          type: "remote",
          url: "[redacted]",
          headers: { Authorization: "[redacted]" },
        },
      },
      futureFeature: { token: "[redacted]", enabled: "[redacted]" },
    });
    expect(JSON.stringify(redacted)).not.toContain("unknown-secret");
    expect(JSON.stringify(redacted)).not.toContain("private prompt");
  });
});

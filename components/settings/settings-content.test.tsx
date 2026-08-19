import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SettingsResponse } from "@/types/oc";
import { SettingsContent } from "./settings-content";

function settings(configured: boolean): SettingsResponse {
  return {
    dbPath: "/tmp/opencode/opencode.db",
    schemaVersion: "opencode-1.17.7",
    opencodeVersion: "1.17.7",
    storage: { dbBytes: 1_024, walBytes: 128, logBytes: null, reposBytes: 512, totalBytes: 1_664 },
    config: configured ? {
      agents: ["build", "plan"],
      mcpServers: [{ name: "docs", transport: "remote" }],
      plugins: ["example-plugin"],
      raw: { agent: { build: { prompt: "[redacted]" } } },
    } : null,
  };
}

describe("OCL-111 settings content", () => {
  it("renders environment, storage, configured safe names, pricing, and observed-skills wording", () => {
    const markup = renderToStaticMarkup(<SettingsContent settings={settings(true)} />);

    for (const value of [
      "/tmp/opencode/opencode.db", "opencode-1.17.7", "1.17.7", "build", "plan", "docs", "remote",
      "example-plugin", "Redacted configuration", "[redacted]", "1.0 KB",
    ]) expect(markup).toContain(value);
    expect(markup).toContain('href="/settings/pricing"');
    expect(markup).toContain("only skills observed in recorded");
    expect(markup).toContain('href="/tools"');
  });

  it("renders the explanatory missing-config state without hiding database diagnostics", () => {
    const markup = renderToStaticMarkup(<SettingsContent settings={settings(false)} />);

    expect(markup).toContain("No config found");
    expect(markup).toContain("No opencode.jsonc or opencode.json was found");
    expect(markup).toContain("/tmp/opencode/opencode.db");
    expect(markup).not.toContain("Configured features");
  });

  it("labels missing database and opencode version honestly", () => {
    const value = settings(false);
    value.dbPath = null;
    value.opencodeVersion = null;
    const markup = renderToStaticMarkup(<SettingsContent settings={value} />);

    expect(markup).toContain("Not found");
    expect(markup).toContain("Not detected");
  });
});

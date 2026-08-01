import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-oc", () => ({
  useOc: (route: string) => route === "/api/settings" ? {
    data: {
      data: {
        dbPath: "/tmp/opencode.db",
        schemaVersion: "opencode-1.17.7",
        opencodeVersion: "1.17.7",
        storage: { dbBytes: 10, walBytes: 0, logBytes: null, reposBytes: null, totalBytes: 10 },
        config: null,
      },
      meta: { generatedAt: 1, schemaVersion: "opencode-1.17.7", warnings: [] },
    },
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  } : {
    data: {
      data: {
        state: "disabled",
        baseUrl: null,
        timeoutMs: 1_500,
        checkedAt: 1,
        mcp: { available: false, items: [], itemCount: null },
        lsp: { available: false, items: [], itemCount: null },
        agent: { available: false, items: [], itemCount: null },
        config: { available: false, items: [], itemCount: null },
      },
      meta: { generatedAt: 1, schemaVersion: "opencode-1.17.7", warnings: [] },
    },
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  },
}));

import SettingsPage from "./page";

describe("OCL-111 SettingsPage", () => {
  it("integrates the historical settings view and the existing optional live-health panel", () => {
    const markup = renderToStaticMarkup(<SettingsPage />);

    expect(markup).toContain("Settings");
    expect(markup).toContain("/tmp/opencode.db");
    expect(markup).toContain("No config found");
    expect(markup).toContain("Live server health");
    expect(markup).toContain("Live health is off");
  });
});

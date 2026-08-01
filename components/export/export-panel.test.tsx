import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mockUseOc = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-oc", () => ({ useOc: mockUseOc }));

import { EXPORT_SCOPES } from "./export-utils";
import { ExportPanel, PreviewGrid, ScopeSelector } from "./export-panel";

describe("ExportPanel", () => {
  it("renders every scope and explicit JSON/ZIP actions without an import affordance", () => {
    mockUseOc.mockReturnValue({
      data: { data: { counts: { sessions: 12, messages: 40, parts: 90, todos: 3 } }, meta: { warnings: [] } },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });
    const markup = renderToStaticMarkup(<ExportPanel />);

    for (const label of ["Sessions", "Overview stats", "Activity", "Tools", "Todos", "Conversation replay"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("Download JSON");
    expect(markup).toContain("Download ZIP");
    expect(markup).not.toMatch(/\bimport\b|upload/i);
  });

  it("renders scope and preview grids responsively with finite counts", () => {
    const selector = renderToStaticMarkup(<ScopeSelector selected={["sessions"]} onToggle={() => undefined} />);
    const preview = renderToStaticMarkup(
      <PreviewGrid scopes={["sessions", "replay"]} counts={{ sessions: 2, messages: 5, parts: 9, todos: 0 }} />,
    );

    expect(selector.match(/type="checkbox"/g)).toHaveLength(EXPORT_SCOPES.length);
    expect(preview).toContain("2 sessions");
    expect(preview).toContain("5 turns · 9 parts");
    expect(preview).not.toMatch(/NaN|Infinity/);
  });

  it("renders loading and zero-count states honestly", () => {
    mockUseOc.mockReturnValue({ data: undefined, error: undefined, isLoading: true, mutate: vi.fn() });
    expect(renderToStaticMarkup(<ExportPanel />)).toContain("Loading export preview");

    mockUseOc.mockReturnValue({
      data: { data: { counts: { sessions: 0, messages: 0, parts: 0, todos: 0 } }, meta: { warnings: [] } },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });
    expect(renderToStaticMarkup(<ExportPanel />)).toContain("Nothing to export in this range");
  });
});

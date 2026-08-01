import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { HeatmapGrid } from "./heatmap-grid";

describe("OCL-142 HeatmapGrid accessibility", () => {
  it("exposes navigable days as named buttons outside image semantics", () => {
    const markup = renderToStaticMarkup(
      <HeatmapGrid
        weeks={[[{ label: "2026-08-01", value: 3 }, { label: "Outside rolling year", value: null }]]}
        onCellClick={vi.fn()}
      />,
    );

    expect(markup).toContain('role="group"');
    expect(markup).not.toContain('role="img"');
    expect(markup).toContain('aria-label="2026-08-01: 3"');
    expect(markup).toMatch(/<button[^>]*aria-label="2026-08-01: 3"[^>]*>/);
  });
});

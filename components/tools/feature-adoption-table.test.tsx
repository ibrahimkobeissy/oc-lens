import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { adoptionRows, FeatureAdoptionTable } from "@/components/tools/feature-adoption-table";
import type { FeatureAdoption } from "@/types/oc";

const zero = { sessionCount: 0, pct: 0, firstUsed: null };
const adoption: FeatureAdoption = { subagents: { sessionCount: 2, pct: 0.25, firstUsed: Date.UTC(2026, 0, 1) }, mcp: zero, webfetch: zero, planMode: zero, reasoning: zero, todos: zero, skills: zero };

describe("OCL-075 feature adoption", () => {
  it("contains exactly the seven allowed evidence-backed rows", () => {
    expect(adoptionRows(adoption).map((row) => row.key)).toEqual(["subagents", "mcp", "webfetch", "planMode", "reasoning", "todos", "skills"]);
  });

  it("renders session count, percentage, and first-use evidence without forbidden guessed rows", () => {
    const html = renderToStaticMarkup(<FeatureAdoptionTable adoption={adoption} />);
    expect(html).toContain("25.0%");
    expect(html).toContain("Sessions with at least one task tool call or a non-null parent_id");
    expect(html).toContain("How detected");
    expect(html).toContain("Adoption (% of sessions in range)");
    expect(html).not.toContain(">Web search</td>");
    expect(html).not.toContain(">Git commits</td>");
  });
});

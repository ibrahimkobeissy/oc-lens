import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { inclusiveSubagentRollup, SubagentTree } from "./subagent-tree";
import type { OcCost, OcSessionModel, OcTokens, SubagentNode } from "@/types/oc";

function node(
  sessionId: string,
  tokens: OcTokens,
  toolCallCount: number,
  cost: OcCost,
  children: SubagentNode[] = [],
  model: OcSessionModel | null = { id: "model", providerID: "provider", variant: "default" },
): SubagentNode {
  return { sessionId, agent: "build", model, durationMs: 1_000, tokens, cost, toolCallCount, children };
}

const fixtureTree = node(
  "ses_0000",
  { input: 302_089, output: 49_749, reasoning: 7_821, cacheRead: 98_801, cacheWrite: 17_139 },
  230,
  { amount: 0.46344, priced: true },
  [
    node("ses_0035", { input: 18_402, output: 2_898, reasoning: 557, cacheRead: 3_549, cacheWrite: 583 }, 13, { amount: 0.025432, priced: true }),
    node("ses_0036", { input: 23_765, output: 3_481, reasoning: 334, cacheRead: 11_688, cacheWrite: 1_256 }, 13, { amount: 0.04019, priced: true }),
    node("ses_0038", { input: 32_858, output: 4_619, reasoning: 1_460, cacheRead: 16_444, cacheWrite: 1_519 }, 28, { amount: 0.05544, priced: true }),
  ],
);

describe("OCL-100 SubagentTree", () => {
  it("computes the exact ses_0000 inclusive token, tool, and all-priced cost totals", () => {
    const rollup = inclusiveSubagentRollup(fixtureTree);
    expect(rollup.tokens).toEqual({ input: 377_114, output: 60_747, reasoning: 10_172, cacheRead: 130_482, cacheWrite: 20_497 });
    expect(rollup.toolCallCount).toBe(284);
    expect(rollup.cost.priced).toBe(true);
    expect(rollup.cost.amount).toBeCloseTo(0.584502, 9);
  });

  it("makes an inclusive cost wholly unpriced when any descendant lacks price evidence", () => {
    const partial = { ...fixtureTree, children: fixtureTree.children.map((child) => child.sessionId === "ses_0038" ? { ...child, cost: { amount: 0, priced: false } } : child) };
    expect(inclusiveSubagentRollup(partial).cost).toEqual({ amount: 0, priced: false });
  });

  it("renders hierarchy, exclusive/inclusive labels, unknowns, per-node duration, and encoded replay links", () => {
    const nested = node("ses_nested", { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, 0, { amount: 0, priced: false });
    const unusual = node("ses/a b", { input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5 }, 1, { amount: 0, priced: false }, [nested], null);
    unusual.agent = null;
    const tree = { ...fixtureTree, children: [...fixtureTree.children, unusual] };
    const html = renderToStaticMarkup(<SubagentTree node={tree} />);

    expect(html).toContain("This session alone");
    expect(html).toContain("Total including subagents");
    expect(html).toContain("unknown agent");
    expect(html).toContain("unknown model");
    expect(html).toContain("1.0s");
    expect(html).toContain('/sessions/ses%2Fa%20b');
    expect(html).toContain('/sessions/ses_nested');
    expect(html).toContain('aria-label="Subagent hierarchy rooted at ses_0000"');
    expect(html.match(/<ul(?: |>)/g)).toHaveLength(3);
    expect(html.match(/<li(?: |>)/g)).toHaveLength(6);
    expect(html).not.toContain('role="tree"');
    expect(html).not.toContain('role="treeitem"');
    expect(html).not.toContain('role="group"');
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain("aria-selected");
  });

  it("renders nothing for a leaf session", () => {
    const leaf = node("leaf", { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, 0, { amount: 0, priced: false });
    expect(renderToStaticMarkup(<SubagentTree node={leaf} />)).toBe("");
  });
});

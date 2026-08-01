import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getReplay } from "@/lib/queries/replay";
import { withFixture } from "@/test/fixtures";
import type { OcTokens } from "@/types/oc";
import { TokenAccumulationChart, tokenAccumulationRows, tokenEvidenceStatus } from "./token-accumulation-chart";

const tokens = (input: number, output: number, reasoning: number, cacheRead: number, cacheWrite: number): OcTokens => ({ input, output, reasoning, cacheRead, cacheWrite });

describe("OCL-056 TokenAccumulationChart", () => {
  it("ends at the populated fixture session total", () => withFixture((db) => {
    const id = (db.prepare("SELECT id FROM session ORDER BY id LIMIT 1").get() as { id: string }).id;
    const replay = getReplay(db, id).data;
    if (!replay) throw new Error("expected fixture replay");

    const final = tokenAccumulationRows(replay.tokenAccumulation).at(-1);
    expect(final).toMatchObject(replay.session.tokens);
    expect(tokenEvidenceStatus(replay)).toMatchObject({ matches: true, invalidEvidence: false });
  }));

  it("renders every stacked token category and an honest mismatch", () => {
    const replay = {
      session: { tokens: tokens(10, 5, 2, 3, 1) },
      tokenAccumulation: [{ atTurnIndex: 0, tokens: tokens(8, 5, 2, 3, 1) }],
    };
    const html = renderToStaticMarkup(<TokenAccumulationChart replay={replay} />);

    for (const label of ["Input", "Output", "Reasoning", "Cache read", "Cache write"]) expect(html).toContain(label);
    expect(html).toContain("Evidence mismatch");
    expect(html).toContain("Step-finish evidence totals 19 tokens, while the session aggregate reports 21.");
  });

  it("renders a clean empty state when both evidence sources are zero", () => {
    const replay = {
      session: { tokens: tokens(0, 0, 0, 0, 0) },
      tokenAccumulation: [],
    };
    const html = renderToStaticMarkup(<TokenAccumulationChart replay={replay} />);

    expect(html).toContain("Matches session total");
    expect(html).toContain("No step-finish token evidence is available for this session.");
    expect(html).not.toContain("Token evidence differs");
  });
});

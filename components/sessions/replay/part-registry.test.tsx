import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ReplayPart, ReplayTurn } from "@/types/oc";
import { partDomId, replayPartRenderer } from "./part-registry";

const turn: ReplayTurn = { messageId: "message", role: "assistant", agent: null, timeCreated: 1, timeCompleted: null, durationMs: null, tokens: null, cost: { amount: 0, priced: false }, parts: [] };

describe("ReplayPartRendererRegistry", () => {
  it("renders the raw upstream type for an unknown part instead of a blank gap", () => {
    const part: ReplayPart = { id: "part/one", data: { type: "unknown", rawType: "future-widget", raw: { secret: "not rendered" } } };
    const Renderer = replayPartRenderer(part.data.type);
    const html = renderToStaticMarkup(<Renderer part={part} turn={turn} />);
    expect(html).toContain("Unsupported replay part");
    expect(html).toContain("future-widget");
    expect(html).not.toContain("not rendered");
  });

  it("creates a stable DOM target for exact part deep links", () => {
    expect(partDomId("part/one two")).toBe("part-part%2Fone%20two");
  });
});

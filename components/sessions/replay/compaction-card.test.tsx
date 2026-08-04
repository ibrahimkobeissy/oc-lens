import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CompactionCard } from "./compaction-card";
import { replayPartRenderer } from "./part-registry";
import { decodePartData } from "@/lib/decode/part";
import type { ReplayPart, ReplayTurn } from "@/types/oc";

function part(overrides: Partial<Extract<ReplayPart["data"], { type: "compaction" }>> = {}): ReplayPart {
  return {
    id: "compaction-part",
    data: { type: "compaction", auto: true, overflow: false, tailStartId: "msg_tail", ...overrides },
  };
}

function turn(): ReplayTurn {
  return {
    messageId: "message",
    role: "assistant",
    agent: "build",
    timeCreated: 1,
    timeCompleted: 2,
    durationMs: 1,
    tokens: null,
    cost: { amount: 0, priced: false },
    parts: [],
  };
}

describe("OCL-055 CompactionCard", () => {
  it("registers the verified compaction renderer and stays collapsed by default", () => {
    expect(replayPartRenderer("compaction")).toBe(CompactionCard);
    const html = renderToStaticMarkup(<CompactionCard part={part()} turn={turn()} />);

    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
    expect(html).toContain("Context compaction");
    expect(html).toContain("msg_tail");
  });

  it("labels auto vs. manual and shows overflow only when observed", () => {
    expect(renderToStaticMarkup(<CompactionCard part={part({ auto: true, overflow: false })} turn={turn()} />)).toContain("automatic");
    expect(renderToStaticMarkup(<CompactionCard part={part({ auto: false, overflow: false })} turn={turn()} />)).toContain("manual");
    expect(renderToStaticMarkup(<CompactionCard part={part({ overflow: true })} turn={turn()} />)).toContain("context overflow");
    expect(renderToStaticMarkup(<CompactionCard part={part({ overflow: false })} turn={turn()} />)).not.toContain("context overflow");
  });

  it("renders only the three fields ever actually observed — no invented pre-compaction token count", () => {
    const html = renderToStaticMarkup(<CompactionCard part={part()} turn={turn()} />);
    expect(html).not.toMatch(/pre.?token/i);
    expect(html).not.toContain("Cost");
  });

  it("renders an honest fallback sentence when tail_start_id was absent — real shape confirmed live 2026-08-03", () => {
    const html = renderToStaticMarkup(<CompactionCard part={part({ tailStartId: null })} turn={turn()} />);
    expect(html).toContain("did not record which message");
    expect(html).not.toContain("starting at message");
  });

  it("decodes a real compaction sample end to end through the registry", () => {
    const decoded = decodePartData(JSON.stringify({ type: "compaction", auto: true, overflow: false, tail_start_id: "msg_real" }));
    expect(decoded.value).toEqual({ type: "compaction", auto: true, overflow: false, tailStartId: "msg_real" });
    const Renderer = replayPartRenderer(decoded.value.type);
    const html = renderToStaticMarkup(<Renderer part={{ id: "real-compaction", data: decoded.value }} turn={turn()} />);
    expect(html).toContain("msg_real");
  });
});

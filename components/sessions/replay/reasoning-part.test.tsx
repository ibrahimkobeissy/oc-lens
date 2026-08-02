import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { replayPartRenderer } from "./part-registry";
import { ReasoningPart, reasoningDuration } from "./reasoning-part";
import { decodePartData } from "@/lib/decode/part";
import type { ReplayPart, ReplayTurn } from "@/types/oc";

function part(timeStart: number | null = 1_783_209_616_914, timeEnd: number | null = 1_783_209_617_111): ReplayPart {
  return { id: "reasoning-part", data: { type: "reasoning", text: "Verified reasoning trace", timeStart, timeEnd } };
}

function turn(tokens: ReplayTurn["tokens"] = { input: 7_912, output: 6, reasoning: 15, cacheRead: 0, cacheWrite: 0 }): ReplayTurn {
  return {
    messageId: "message",
    role: "assistant",
    agent: "build",
    timeCreated: 1,
    timeCompleted: 2,
    durationMs: 1,
    tokens,
    cost: { amount: 0, priced: false },
    parts: [],
  };
}

describe("OCL-055 ReasoningPart", () => {
  it("registers the verified reasoning renderer and stays collapsed by default", () => {
    expect(replayPartRenderer("reasoning")).toBe(ReasoningPart);
    const html = renderToStaticMarkup(<ReasoningPart part={part()} turn={turn()} />);

    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
    expect(html).toContain("Verified reasoning trace");
    expect(html).toContain("197ms");
    expect(html).toContain("15 turn reasoning tokens");
  });

  it("derives duration only from complete ordered reasoning timestamps", () => {
    expect(reasoningDuration(100, 250)).toBe(150);
    expect(reasoningDuration(null, 250)).toBeNull();
    expect(reasoningDuration(100, null)).toBeNull();
    expect(reasoningDuration(250, 100)).toBeNull();

    const html = renderToStaticMarkup(<ReasoningPart part={part(250, 100)} turn={turn(null)} />);
    expect(html).toContain("—");
    expect(html).toContain("Reasoning tokens unavailable");
    expect(html).not.toMatch(/NaN|Infinity|0ms/);
  });

  it("does not render unobserved compaction or pre-token fields", () => {
    const html = renderToStaticMarkup(<ReasoningPart part={part()} turn={turn()} />);
    expect(html).not.toContain(">Compaction<");
    expect(html).not.toMatch(/pre.?token/i);
    expect(html).not.toContain(">Overflow<");
  });

  it("falls back a malformed compaction part to the labelled unknown renderer rather than inventing fields", () => {
    // `compaction`'s real shape (auto/overflow/tail_start_id) was confirmed live on 2026-08-02
    // (see ./compaction-card.test.tsx) — this checks the *malformed* case still falls back honestly.
    const decoded = decodePartData(JSON.stringify({ type: "compaction", invented: "must not render" }));
    expect(decoded.value).toMatchObject({ type: "unknown", rawType: "compaction" });
    const Renderer = replayPartRenderer(decoded.value.type);
    const html = renderToStaticMarkup(<Renderer part={{ id: "unknown-compaction", data: decoded.value }} turn={turn()} />);
    expect(html).toContain("Unsupported replay part");
    expect(html).toContain("compaction");
    expect(html).not.toContain("must not render");
  });
});

import { describe, expect, it } from "vitest";
import { decodeParts, decodePartData } from "../part";

// Verbatim samples from project-docs/opencode-data-model.md §5.
const TEXT_RAW = JSON.stringify({ type: "text", text: "hello" });
const REASONING_RAW = JSON.stringify({
  type: "reasoning",
  text: "thinking…",
  time: { start: 1783209616914, end: 1783209617111 },
});
const STEP_START_RAW = JSON.stringify({ type: "step-start" });
const STEP_FINISH_RAW = JSON.stringify({
  reason: "stop",
  type: "step-finish",
  cost: 0,
  tokens: { total: 7933, input: 7912, output: 6, reasoning: 15, cache: { write: 0, read: 0 } },
});
const TOOL_RAW = JSON.stringify({
  type: "tool",
  tool: "write",
  callID: "call_00_hsbVhWA52OF29N1XTRvE7557",
  state: {
    status: "completed",
    input: { filePath: "/…/fizzbuzz.py", content: "…" },
    output: "Wrote file successfully.",
    metadata: { diagnostics: {}, filepath: "/…/fizzbuzz.py", exists: false, truncated: false },
    title: "tmp/…/fizzbuzz.py",
    time: { start: 1783209635239, end: 1783209635254 },
  },
});

describe("decodePartData", () => {
  it("decodes the verbatim text sample", () => {
    const { value, warnings } = decodePartData(TEXT_RAW);
    expect(warnings).toEqual([]);
    expect(value).toEqual({ type: "text", text: "hello" });
  });

  it("decodes the verbatim reasoning sample", () => {
    const { value, warnings } = decodePartData(REASONING_RAW);
    expect(warnings).toEqual([]);
    expect(value).toEqual({
      type: "reasoning",
      text: "thinking…",
      timeStart: 1783209616914,
      timeEnd: 1783209617111,
    });
  });

  it("decodes the verbatim step-start sample", () => {
    const { value, warnings } = decodePartData(STEP_START_RAW);
    expect(warnings).toEqual([]);
    expect(value).toEqual({ type: "step-start" });
  });

  it("decodes the verbatim step-finish sample", () => {
    const { value, warnings } = decodePartData(STEP_FINISH_RAW);
    expect(warnings).toEqual([]);
    expect(value).toEqual({
      type: "step-finish",
      reason: "stop",
      cost: 0,
      tokens: { input: 7912, output: 6, reasoning: 15, cacheRead: 0, cacheWrite: 0 },
    });
  });

  it("decodes the verbatim tool sample", () => {
    const { value, warnings } = decodePartData(TOOL_RAW);
    expect(warnings).toEqual([]);
    expect(value).toEqual({
      type: "tool",
      tool: "write",
      callId: "call_00_hsbVhWA52OF29N1XTRvE7557",
      status: "completed",
      input: { filePath: "/…/fizzbuzz.py", content: "…" },
      output: "Wrote file successfully.",
      title: "tmp/…/fizzbuzz.py",
      timeStart: 1783209635239,
      timeEnd: 1783209635254,
    });
  });

  it("an unknown part type decodes to the unknown variant with a warning, never throwing", () => {
    const raw = JSON.stringify({ type: "patch", files: [] });
    const { value, warnings } = decodePartData(raw);
    expect(value.type).toBe("unknown");
    expect(value).toMatchObject({ type: "unknown", rawType: "patch" });
    expect(warnings.some((w) => w.code === "unknown-part-type")).toBe(true);
  });

  it("never throws on malformed JSON, null, or empty string — each produces a warning and a safe value", () => {
    for (const raw of ["{not json", null, ""]) {
      const { value, warnings } = decodePartData(raw);
      expect(value.type).toBe("unknown");
      expect(warnings.length).toBeGreaterThan(0);
    }
  });
});

describe("decodeParts (batch)", () => {
  it("aggregates warnings across a batch by code — 3 unknown types in 100 parts is one warning with count 3", () => {
    const raws: string[] = [];
    for (let i = 0; i < 100; i++) {
      raws.push(i < 3 ? JSON.stringify({ type: "compaction" }) : TEXT_RAW);
    }
    const { values, warnings } = decodeParts(raws);
    expect(values).toHaveLength(100);
    const unknownTypeWarnings = warnings.filter((w) => w.code === "unknown-part-type");
    expect(unknownTypeWarnings).toHaveLength(1);
    expect(unknownTypeWarnings[0]?.count).toBe(3);
  });
});

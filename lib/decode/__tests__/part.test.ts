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
// Real shape confirmed live against a developer's opencode.db on 2026-08-02 (data-model §5).
const COMPACTION_RAW = JSON.stringify({
  type: "compaction",
  auto: true,
  overflow: false,
  tail_start_id: "msg_fc2bf37c6001K6Sh2mjXGJQsKN",
});
// Real shape confirmed live against a developer's opencode.db on 2026-08-02 (data-model §5).
const PATCH_RAW = JSON.stringify({
  type: "patch",
  hash: "094c0ec1231b737617bded055272857a3c644f8a",
  files: ["/home/user/project/lib/pricing/__tests__/route.test.ts"],
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

  it("keeps malformed step-finish token evidence unknown and warns", () => {
    const decoded = decodePartData(JSON.stringify({
      type: "step-finish",
      reason: "stop",
      tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 1 } },
    }));
    expect(decoded.value).toMatchObject({ type: "step-finish", tokens: null });
    expect(decoded.warnings).toContainEqual(expect.objectContaining({ code: "malformed-step-tokens" }));
  });

  it("decodes the verbatim compaction sample", () => {
    const { value, warnings } = decodePartData(COMPACTION_RAW);
    expect(warnings).toEqual([]);
    expect(value).toEqual({
      type: "compaction",
      auto: true,
      overflow: false,
      tailStartId: "msg_fc2bf37c6001K6Sh2mjXGJQsKN",
    });
  });

  it("falls back to unknown, with a warning, when a compaction part is missing auto/overflow", () => {
    const { value, warnings } = decodePartData(JSON.stringify({ type: "compaction" }));
    expect(value.type).toBe("unknown");
    expect(warnings.some((w) => w.code === "malformed-compaction")).toBe(true);
  });

  it("decodes a compaction part with no tail_start_id at all as tailStartId: null — real shape confirmed live 2026-08-03", () => {
    const { value, warnings } = decodePartData(JSON.stringify({ type: "compaction", auto: true, overflow: true }));
    expect(warnings).toEqual([]);
    expect(value).toEqual({ type: "compaction", auto: true, overflow: true, tailStartId: null });
  });

  it("still rejects a compaction part whose tail_start_id is present but the wrong type", () => {
    const { value, warnings } = decodePartData(JSON.stringify({ type: "compaction", auto: true, overflow: true, tail_start_id: 42 }));
    expect(value.type).toBe("unknown");
    expect(warnings.some((w) => w.code === "malformed-compaction")).toBe(true);
  });

  it("decodes the verbatim patch sample", () => {
    const { value, warnings } = decodePartData(PATCH_RAW);
    expect(warnings).toEqual([]);
    expect(value).toEqual({
      type: "patch",
      hash: "094c0ec1231b737617bded055272857a3c644f8a",
      files: ["/home/user/project/lib/pricing/__tests__/route.test.ts"],
    });
  });

  it("falls back to unknown, with a warning, when a patch part is missing hash/files", () => {
    const { value, warnings } = decodePartData(JSON.stringify({ type: "patch" }));
    expect(value.type).toBe("unknown");
    expect(warnings.some((w) => w.code === "malformed-patch")).toBe(true);
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

  it("preserves a tool failure recorded in state.error when state.output is absent", () => {
    const { value, warnings } = decodePartData(JSON.stringify({
      type: "tool",
      tool: "bash",
      callID: "failed-call",
      state: { status: "error", input: {}, error: "Permission denied" },
    }));

    expect(warnings).toEqual([]);
    expect(value).toMatchObject({ type: "tool", status: "error", output: "Permission denied" });
  });

  it("decodes missing and future tool statuses as one explicit unknown bucket", () => {
    const raws = [
      JSON.stringify({ type: "tool", tool: "bash", callID: "missing", state: { input: {} } }),
      JSON.stringify({ type: "tool", tool: "bash", callID: "future", state: { status: "paused", input: {} } }),
    ];
    const decoded = decodeParts(raws);

    expect(decoded.values).toEqual([
      expect.objectContaining({ type: "tool", status: "unknown" }),
      expect.objectContaining({ type: "tool", status: "unknown" }),
    ]);
    expect(decoded.warnings).toEqual([{
      code: "unknown-tool-status",
      message: "Tool parts had an unrecognised or missing state.status; rendered as unknown",
      count: 2,
    }]);
  });

  it("an unknown part type decodes to the unknown variant with a warning, never throwing", () => {
    const raw = JSON.stringify({ type: "snapshot", files: [] });
    const { value, warnings } = decodePartData(raw);
    expect(value.type).toBe("unknown");
    expect(value).toMatchObject({ type: "unknown", rawType: "snapshot" });
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
      raws.push(i < 3 ? JSON.stringify({ type: "snapshot" }) : TEXT_RAW);
    }
    const { values, warnings } = decodeParts(raws);
    expect(values).toHaveLength(100);
    const unknownTypeWarnings = warnings.filter((w) => w.code === "unknown-part-type");
    expect(unknownTypeWarnings).toHaveLength(1);
    expect(unknownTypeWarnings[0]?.count).toBe(3);
  });
});

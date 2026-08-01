import { describe, expect, it } from "vitest";
import { decodeMessageData } from "../message";

// Verbatim samples from project-docs/opencode-data-model.md §4.
const ASSISTANT_MESSAGE_RAW = JSON.stringify({
  parentID: "msg_f2f935f34001dJ3sEIRokroWdR",
  role: "assistant",
  mode: "build",
  agent: "build",
  path: { cwd: "/…/oc-test", root: "/" },
  cost: 0,
  tokens: {
    total: 7933,
    input: 7912,
    output: 6,
    reasoning: 15,
    cache: { write: 0, read: 0 },
  },
  modelID: "deepseek-v4-flash-free",
  providerID: "opencode",
  time: { created: 1783209615279, completed: 1783209617176 },
  finish: "stop",
});

const USER_MESSAGE_RAW = JSON.stringify({
  role: "user",
  time: { created: 1783209615156 },
  agent: "build",
  model: { providerID: "opencode", modelID: "deepseek-v4-flash-free" },
  summary: { diffs: [] },
});

describe("decodeMessageData", () => {
  it("decodes the verbatim assistant message sample", () => {
    const { value, warnings } = decodeMessageData(ASSISTANT_MESSAGE_RAW);
    expect(warnings).toEqual([]);
    expect(value).toEqual({
      role: "assistant",
      agent: "build",
      mode: "build",
      modelID: "deepseek-v4-flash-free",
      providerID: "opencode",
      tokens: { input: 7912, output: 6, reasoning: 15, cacheRead: 0, cacheWrite: 0 },
      cost: 0,
      timeCreated: 1783209615279,
      timeCompleted: 1783209617176,
      parentId: "msg_f2f935f34001dJ3sEIRokroWdR",
      finish: "stop",
    });
  });

  it("decodes the verbatim user message sample, falling back to nested model.{providerID,modelID}", () => {
    const { value, warnings } = decodeMessageData(USER_MESSAGE_RAW);
    expect(warnings).toEqual([]);
    expect(value.role).toBe("user");
    expect(value.agent).toBe("build");
    expect(value.modelID).toBe("deepseek-v4-flash-free");
    expect(value.providerID).toBe("opencode");
    expect(value.tokens).toBeNull();
    expect(value.timeCreated).toBe(1783209615156);
    expect(value.timeCompleted).toBeNull();
  });

  it("time.completed absent yields null, not 0", () => {
    const { value } = decodeMessageData(USER_MESSAGE_RAW);
    expect(value.timeCompleted).toBeNull();
  });

  it("reads tokens.cache.read/write from the nested path, not a flat field", () => {
    const raw = JSON.stringify({
      role: "assistant",
      time: { created: 1 },
      tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 99, write: 42 } },
      cache_read_input_tokens: 12345, // a flat Claude-Code-style field that must be ignored
    });
    const { value } = decodeMessageData(raw);
    expect(value.tokens?.cacheRead).toBe(99);
    expect(value.tokens?.cacheWrite).toBe(42);
  });

  it("never throws on malformed JSON, and produces a warning", () => {
    const { value, warnings } = decodeMessageData("{not json");
    expect(value.role).toBe("unknown");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("malformed-message-data");
  });

  it("never throws on null, and produces a warning", () => {
    const { value, warnings } = decodeMessageData(null);
    expect(value.role).toBe("unknown");
    expect(warnings[0]?.code).toBe("malformed-message-data");
  });

  it("never throws on empty string, and produces a warning", () => {
    const { warnings } = decodeMessageData("");
    expect(warnings[0]?.code).toBe("malformed-message-data");
  });

  it("an unrecognised role decodes to 'unknown' rather than throwing, with a warning", () => {
    const raw = JSON.stringify({ role: "system", time: { created: 1 } });
    const { value, warnings } = decodeMessageData(raw);
    expect(value.role).toBe("unknown");
    expect(warnings.some((w) => w.code === "unknown-message-role")).toBe(true);
  });
});

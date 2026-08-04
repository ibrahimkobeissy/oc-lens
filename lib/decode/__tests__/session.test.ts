import { describe, expect, it } from "vitest";
import { decodeSessionModel, decodeSessionPermission, isPlaceholderTitle } from "../session";

describe("decodeSessionModel", () => {
  it("returns null for a NULL column, with no warning", () => {
    const { value, warnings } = decodeSessionModel(null);
    expect(value).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("returns null for an empty string, with no warning", () => {
    const { value, warnings } = decodeSessionModel("");
    expect(value).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("parses the verbatim session.model blob from data-model §2", () => {
    const raw = JSON.stringify({ id: "deepseek-v4-flash-free", providerID: "opencode", variant: "default" });
    const { value, warnings } = decodeSessionModel(raw);
    expect(warnings).toEqual([]);
    expect(value).toEqual({ id: "deepseek-v4-flash-free", providerID: "opencode", variant: "default" });
  });

  it("never throws on malformed JSON — returns null with a warning", () => {
    const { value, warnings } = decodeSessionModel("{not json");
    expect(value).toBeNull();
    expect(warnings[0]?.code).toBe("malformed-session-model");
  });

  it("returns null with a warning when id or providerID is missing", () => {
    const { value, warnings } = decodeSessionModel(JSON.stringify({ id: "x" }));
    expect(value).toBeNull();
    expect(warnings[0]?.code).toBe("malformed-session-model");
  });

  it("decodes a model with no variant key at all as variant: null — real shape confirmed live 2026-08-03 (custom LiteLLM provider)", () => {
    const raw = JSON.stringify({ id: "ClovisLLM", providerID: "litellm" });
    const { value, warnings } = decodeSessionModel(raw);
    expect(warnings).toEqual([]);
    expect(value).toEqual({ id: "ClovisLLM", providerID: "litellm", variant: null });
  });
});

describe("decodeSessionPermission", () => {
  it("returns null for a NULL column", () => {
    const { value, warnings } = decodeSessionPermission(null);
    expect(value).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("parses the verbatim session.permission array from data-model §2", () => {
    const raw = JSON.stringify([{ permission: "question", pattern: "*", action: "deny" }]);
    const { value, warnings } = decodeSessionPermission(raw);
    expect(warnings).toEqual([]);
    expect(value).toEqual([{ permission: "question", pattern: "*", action: "deny" }]);
  });

  it("never throws on malformed JSON — returns null with a warning", () => {
    const { value, warnings } = decodeSessionPermission("{not json");
    expect(value).toBeNull();
    expect(warnings[0]?.code).toBe("malformed-session-permission");
  });
});

describe("isPlaceholderTitle", () => {
  it("matches the verbatim placeholder pattern from data-model §2", () => {
    expect(isPlaceholderTitle("New session - 2026-07-05T00:00:14.641Z")).toBe(true);
  });

  it("does not match a real generated title", () => {
    expect(isPlaceholderTitle("Fix the fizzbuzz off-by-one")).toBe(false);
  });

  it("does not match a near-miss string", () => {
    expect(isPlaceholderTitle("New session")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { categorizeTool, categorizeToolsBatch, toolDisplayName } from "../categories";
import type { ToolCategory } from "@/types/oc";

const EXPECTED: Record<string, ToolCategory> = {
  read: "file",
  write: "file",
  edit: "file",
  patch: "file",
  bash: "exec",
  grep: "search",
  glob: "search",
  list: "search",
  webfetch: "web",
  todowrite: "planning",
  todoread: "planning",
  task: "delegation",
  skill: "delegation",
  question: "planning",
  invalid: "other",
};

describe("categorizeTool", () => {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(`categorises "${name}" as "${expected}"`, () => {
      expect(categorizeTool(name)).toBe(expected);
    });
  }

  it("categorises an unrecognised name as the honest 'other' fallback", () => {
    expect(categorizeTool("some_future_tool")).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(categorizeTool("BASH")).toBe("exec");
  });
});

describe("toolDisplayName", () => {
  it("returns a human label for a known tool", () => {
    expect(toolDisplayName("webfetch")).toBe("Web Fetch");
  });

  it("falls back to the raw name for an unrecognised tool", () => {
    expect(toolDisplayName("some_future_tool")).toBe("some_future_tool");
  });
});

describe("categorizeToolsBatch", () => {
  it("aggregates one warning per distinct unknown tool, with a count", () => {
    const names = ["read", "read", "mystery", "mystery", "mystery", "bash"];
    const { categories, warnings } = categorizeToolsBatch(names);

    expect(categories["read"]).toBe("file");
    expect(categories["bash"]).toBe("exec");
    expect(categories["mystery"]).toBe("other");

    expect(warnings).toEqual([
      {
        code: "unknown-tool",
        message: 'Tool "mystery" is not in the known opencode tool set and was categorised as "other".',
        count: 3,
      },
    ]);
  });

  it("emits no warnings when every tool is recognised", () => {
    const { warnings } = categorizeToolsBatch(["read", "write", "bash"]);
    expect(warnings).toEqual([]);
  });
});

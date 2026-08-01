import { describe, expect, it } from "vitest";
import { categoryColor, toolColor } from "../colors";
import type { ToolCategory } from "@/types/oc";

const ALL_CATEGORIES: ToolCategory[] = ["file", "search", "exec", "web", "planning", "delegation", "other"];

describe("categoryColor", () => {
  it("gives every category a distinct chart colour", () => {
    const colors = ALL_CATEGORIES.map(categoryColor);
    expect(new Set(colors).size).toBe(ALL_CATEGORIES.length);
  });

  it("returns a --chart-N css var reference for every category", () => {
    for (const category of ALL_CATEGORIES) {
      expect(categoryColor(category)).toMatch(/^var\(--chart-\d\)$/);
    }
  });
});

describe("toolColor", () => {
  it("resolves a tool name to its category's colour", () => {
    expect(toolColor("bash")).toBe(categoryColor("exec"));
    expect(toolColor("read")).toBe(categoryColor("file"));
  });

  it("resolves an unrecognised tool to the 'other' colour", () => {
    expect(toolColor("some_future_tool")).toBe(categoryColor("other"));
  });
});

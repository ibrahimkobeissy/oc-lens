import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { prettyPrintToolInput, TOOL_INPUT_PREVIEW_CHARS, TOOL_OUTPUT_PREVIEW_CHARS, ToolCallCard, toolDuration } from "./tool-part";
import type { OcPartToolData } from "@/types/oc";

function tool(overrides: Partial<OcPartToolData> = {}): OcPartToolData {
  return { type: "tool", tool: "bash", callId: "call-1", status: "completed", input: { command: "pwd" }, output: "done", title: "Run command", timeStart: 1_000, timeEnd: 1_025, ...overrides };
}

describe("ToolCallCard", () => {
  it("renders the taxonomy, collapsed pretty input, title, status, output, and per-call duration", () => {
    const html = renderToStaticMarkup(<ToolCallCard data={tool()} />);
    expect(html).toContain("Bash");
    expect(html).toContain("exec");
    expect(html).toContain("var(--chart-3)");
    expect(html).toContain("completed");
    expect(html).toContain("Run command");
    expect(html).toContain("25ms");
    expect(html).toContain("Input arguments");
    expect(html).toContain('&quot;command&quot;: &quot;pwd&quot;');
    expect(html).not.toContain("<details open");
  });

  it("makes failures visually distinct and exposes the decoded output as the error message", () => {
    const html = renderToStaticMarkup(<ToolCallCard data={tool({ status: "error", output: "Permission denied" })} />);
    expect(html).toContain("border-destructive");
    expect(html).toContain("Tool call failed");
    expect(html).toContain("Error message");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Permission denied");
  });

  it("uses a dash rather than zero for incomplete or invalid timing", () => {
    expect(toolDuration(tool({ timeEnd: null }))).toBeNull();
    expect(toolDuration(tool({ timeStart: 20, timeEnd: 10 }))).toBeNull();
    const html = renderToStaticMarkup(<ToolCallCard data={tool({ timeEnd: null })} />);
    expect(html).toContain("Duration —");
    expect(html).not.toContain("0ms");
  });

  it("renders an explicit unknown status badge", () => {
    const html = renderToStaticMarkup(<ToolCallCard data={tool({ status: "unknown" })} />);
    expect(html).toContain(">unknown<");
    expect(html).not.toContain(">pending<");
  });

  it("bounds a 500 KB output until an explicit expansion", () => {
    const output = `${"x".repeat(500 * 1024)}TAIL_MARKER`;
    const html = renderToStaticMarkup(<ToolCallCard data={tool({ output })} />);
    expect(html).toContain("Show full output (500.0 KB)");
    expect(html).toContain(`… truncated (${output.length - TOOL_OUTPUT_PREVIEW_CHARS} more characters)`);
    expect(html).not.toContain("TAIL_MARKER");
    expect(html.length).toBeLessThan(TOOL_OUTPUT_PREVIEW_CHARS * 2);
  });

  it("pretty-prints opaque input while bounding long values and total output", () => {
    const rendered = prettyPrintToolInput({ content: "a".repeat(30_000), nested: { ok: true } });
    expect(rendered).toContain('&quot;nested&quot;'.replaceAll("&quot;", '"'));
    expect(rendered).toContain("truncated");
    expect(rendered.length).toBeLessThanOrEqual(TOOL_INPUT_PREVIEW_CHARS + 64);
  });
});

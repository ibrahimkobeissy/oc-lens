import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { groupConsecutiveToolParts, ToolGroup } from "./tool-group";
import type { ReplayPart, ReplayTurn } from "@/types/oc";

function toolPart(id: string, tool: string, status: "completed" | "error" | "pending" | "running" | "unknown" = "completed"): ReplayPart {
  return { id, data: { type: "tool", tool, callId: id, status, input: {}, output: id, title: null, timeStart: 1, timeEnd: 2 } };
}

const turn: ReplayTurn = { messageId: "message", role: "assistant", agent: null, timeCreated: 1, timeCompleted: null, durationMs: null, tokens: null, cost: { amount: 0, priced: false }, parts: [] };

describe("tool call grouping", () => {
  it("groups only runs of at least three consecutive calls to the same tool", () => {
    const text: ReplayPart = { id: "text", data: { type: "text", text: "break" } };
    const items = groupConsecutiveToolParts([
      toolPart("r1", "read"), toolPart("r2", "read"), text,
      toolPart("b1", "bash"), toolPart("b2", "bash"), toolPart("b3", "bash"),
      toolPart("r3", "read"), toolPart("r4", "read"), toolPart("r5", "read"), toolPart("r6", "read"),
    ]);
    expect(items.map((item) => item.kind === "tool-group" ? `${item.tool}:${item.parts.length}` : item.part.id)).toEqual([
      "r1", "r2", "text", "bash:3", "read:4",
    ]);
  });

  it("renders a collapsed summary with category, count, failures, and explicit expand control", () => {
    const parts = [toolPart("one", "bash"), toolPart("two", "bash", "error"), toolPart("three", "bash", "running")];
    const html = renderToStaticMarkup(<ToolGroup parts={parts} turn={turn} />);
    expect(html).toContain("3 consecutive Bash calls");
    expect(html).toContain("exec");
    expect(html).toContain("1 failed");
    expect(html).toContain("1 completed");
    expect(html).toContain("1 running");
    expect(html).toContain("Expand calls");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Permission denied");
    expect(html).not.toContain("Run command");
  });

  it("can begin expanded so an exact part deep link has a focus target", () => {
    const parts = [toolPart("part/one", "read"), toolPart("two", "read"), toolPart("three", "read")];
    const html = renderToStaticMarkup(<ToolGroup parts={parts} turn={turn} defaultExpanded />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('id="part-part%2Fone"');
    expect(html).toContain('data-part-id="part/one"');
  });

  it("counts unknown statuses explicitly in a collapsed group", () => {
    const parts = [toolPart("one", "read"), toolPart("two", "read", "unknown"), toolPart("three", "read", "unknown")];
    const html = renderToStaticMarkup(<ToolGroup parts={parts} turn={turn} />);
    expect(html).toContain("2 unknown");
    expect(html).not.toContain("2 pending");
  });

  it("expands from the current target rather than only the initial target", () => {
    const parts = [toolPart("one", "read"), toolPart("two", "read"), toolPart("three", "read")];
    const before = renderToStaticMarkup(<ToolGroup parts={parts} turn={turn} targetPartId="elsewhere" />);
    const afterTargetChange = renderToStaticMarkup(<ToolGroup parts={parts} turn={turn} targetPartId="two" />);

    expect(before).toContain('aria-expanded="false"');
    expect(before).not.toContain('data-part-id="two"');
    expect(afterTargetChange).toContain('aria-expanded="true"');
    expect(afterTargetChange).toContain('data-part-id="two"');
  });
});

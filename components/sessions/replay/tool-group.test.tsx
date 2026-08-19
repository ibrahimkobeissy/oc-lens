import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { effectiveExpanded, groupConsecutiveToolParts, ToolGroup } from "./tool-group";
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

  it("respects an explicit user collapse even while ?part= still targets this group (code-review-2026-08-02.md M4)", () => {
    // This was the bug: the old `userExpanded || targetExpanded` formula meant clicking
    // "Collapse calls" (userExpanded -> false) did nothing as long as targetExpanded stayed true.
    expect(effectiveExpanded(false, true, false)).toBe(false);
  });

  it("respects an explicit user expand even when neither the target nor the default would open it", () => {
    expect(effectiveExpanded(true, false, false)).toBe(true);
  });

  it("defers to the target/default before any explicit click", () => {
    expect(effectiveExpanded(null, true, false)).toBe(true);
    expect(effectiveExpanded(null, false, true)).toBe(true);
    expect(effectiveExpanded(null, false, false)).toBe(false);
  });
});

describe("loop marking inside a tool group", () => {
  function readPart(id: string, filePath: string): ReplayPart {
    return {
      id,
      data: {
        type: "tool",
        tool: "read",
        callId: `call-${id}`,
        status: "completed",
        input: { filePath },
        output: "ok",
        title: filePath,
        timeStart: 1,
        timeEnd: 2,
      },
    };
  }

  const parts = ["a", "b", "c", "d", "e"].map((suffix) => readPart(`part-${suffix}`, `/repo/${suffix}.tsx`));

  function turnOf(): ReplayTurn {
    return {
      messageId: "message-group",
      role: "assistant",
      agent: "build",
      timeCreated: 1,
      timeCompleted: 2,
      durationMs: 1,
      tokens: null,
      cost: { amount: 0, priced: false },
      parts,
    };
  }

  it("marks the one repeated call inside a five-call group, not the whole group", () => {
    const marks = new Map([["part-c", { position: 1, total: 3, partIds: ["part-c", "x1", "x2"] }]]);
    const html = renderToStaticMarkup(
      <ToolGroup parts={parts} turn={turnOf()} defaultExpanded loopParts={marks} />,
    );
    expect(html.match(/data-looped="true"/g)?.length).toBe(1);
    expect(html).toContain("Same call, run 3× in this session");
    expect(html).toContain("1 also run elsewhere");
  });

  it("still says a repeat is inside when the group is collapsed", () => {
    const marks = new Map([["part-c", { position: 1, total: 3, partIds: ["part-c", "x1", "x2"] }]]);
    const html = renderToStaticMarkup(<ToolGroup parts={parts} turn={turnOf()} loopParts={marks} />);
    expect(html).toContain("1 also run elsewhere");
  });

  it("marks nothing when no call in the group repeated", () => {
    const html = renderToStaticMarkup(
      <ToolGroup parts={parts} turn={turnOf()} defaultExpanded loopParts={new Map()} />,
    );
    expect(html).not.toContain("data-looped");
    expect(html).not.toContain("also run elsewhere");
  });
});

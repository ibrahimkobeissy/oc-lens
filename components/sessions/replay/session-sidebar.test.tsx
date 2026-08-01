import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ReplayTurn, SessionReplay } from "@/types/oc";
import { jumpToReplayTurn, mostVisibleTurn, scrollMountedReplayTurn, SessionSidebar } from "./session-sidebar";

function turn(index: number, role: ReplayTurn["role"] = "assistant"): ReplayTurn {
  return { messageId: `message-${index}`, role, agent: role === "assistant" ? "build" : null, timeCreated: index, timeCompleted: null, durationMs: null, tokens: null, cost: { amount: 0, priced: false }, parts: [{ id: `part-${index}`, data: { type: "text", text: `Turn preview ${index}` } }] };
}

function replay(): SessionReplay {
  return {
    session: {
      id: "session", slug: "session", title: "Sidebar session", projectId: "project", projectDisplayName: "Project", directory: "/project", agent: null, model: null, version: "1", timeCreated: 1, timeUpdated: 2, durationMs: 1, timeArchived: null, parentId: null,
      messageCounts: { user: 1, assistant: 2 }, toolCallCount: 0, errorCount: 0, tokens: { input: 100, output: 20, reasoning: 5, cacheRead: 10, cacheWrite: 0 }, cost: { amount: 0, priced: false }, hasReasoning: false, hasCompaction: false, usesMcp: false, usesSubagent: false, usesWebfetch: false,
    },
    parentId: null,
    childIds: [],
    turns: [turn(0, "user"), turn(1), turn(2)],
    tokenAccumulation: [],
  };
}

describe("OCL-056 SessionSidebar", () => {
  it("renders sticky desktop metadata, an active turn index, and a mobile Sheet trigger", () => {
    const html = renderToStaticMarkup(<SessionSidebar replay={replay()} onTurnJump={vi.fn()} />);

    expect(html).toContain('aria-label="Session replay sidebar"');
    expect(html).toContain("sticky top-20 hidden");
    expect(html).toContain("unknown agent");
    expect(html).toContain("unknown model");
    expect(html).toContain('aria-label="Replay turn index"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("1. Turn preview 0");
    expect(html).toContain("Session details and turn index");
    expect(html).toContain("lg:hidden");
  });

  it("selects the most visible turn deterministically for scroll-spy highlighting", () => {
    expect(mostVisibleTurn([
      { index: 5, intersectionRatio: 0.5, top: 200 },
      { index: 4, intersectionRatio: 0.75, top: 500 },
      { index: 3, intersectionRatio: 0.75, top: 20 },
    ])).toBe(3);
    expect(mostVisibleTurn([{ index: 1, intersectionRatio: 0, top: 0 }])).toBeNull();
  });

  it("scrolls a mounted turn and reports an off-window turn honestly", () => {
    const scrollIntoView = vi.fn();
    const onTurnJump = vi.fn();
    const target = { dataset: { messageId: "message-2" }, scrollIntoView } as unknown as HTMLElement;
    const other = { dataset: { messageId: "message-1" }, scrollIntoView: vi.fn() } as unknown as HTMLElement;
    const root = { querySelectorAll: () => [other, target] } as unknown as ParentNode;

    expect(jumpToReplayTurn({ messageId: "message-2" }, 2, onTurnJump, root)).toBe(true);
    expect(onTurnJump).toHaveBeenCalledWith(2);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(scrollMountedReplayTurn("off-window", root)).toBe(false);
  });
});

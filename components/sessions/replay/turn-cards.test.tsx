import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mockUseVirtualizer = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: mockUseVirtualizer }));

import type { ReplayTurn } from "@/types/oc";
import { REPLAY_TARGET_MOUNT_ATTEMPTS, REPLAY_WINDOW_OVERSCAN, replayTurnFocusTarget, replayTurnIndexForPart, scrollToReplayTurn, TurnCard, waitForReplayTarget, WindowedTurnStream } from "./turn-cards";

function turn(index: number, role: ReplayTurn["role"] = index % 2 === 0 ? "user" : "assistant"): ReplayTurn {
  return { messageId: `message-${index}`, role, agent: role === "assistant" ? "build" : null, timeCreated: index + 1, timeCompleted: null, durationMs: null, tokens: null, cost: { amount: 0, priced: false }, parts: [{ id: `part-${index}`, data: { type: "text", text: `turn ${index}` } }] };
}

describe("replay turn cards", () => {
  it("renders user and assistant cards distinctly and labels unknown roles", () => {
    expect(renderToStaticMarkup(<TurnCard turn={turn(1, "user")} />)).toContain('aria-label="User turn"');
    expect(renderToStaticMarkup(<TurnCard turn={turn(2, "assistant")} />)).toContain('aria-label="Assistant turn"');
    expect(renderToStaticMarkup(<TurnCard turn={turn(3, "unknown")} />)).toContain("Unknown role");
  });

  it("renders only the virtual window for a 400-message session", () => {
    mockUseVirtualizer.mockReturnValue({
      getVirtualItems: () => [198, 199, 200, 201, 202].map((index) => ({ index, key: `message-${index}`, start: index * 200, size: 200, end: index * 200 + 200, lane: 0 })),
      getTotalSize: () => 80_000,
      measureElement: vi.fn(),
      scrollToIndex: vi.fn(),
    });
    const turns = Array.from({ length: 400 }, (_, index) => turn(index));
    const html = renderToStaticMarkup(<WindowedTurnStream turns={turns} />);
    expect(mockUseVirtualizer).toHaveBeenCalledWith(expect.objectContaining({ count: 400, overscan: REPLAY_WINDOW_OVERSCAN }));
    expect(html).toContain('role="feed"');
    expect(html).toContain('aria-label="Ordered replay turns"');
    expect(html).toContain('data-message-id="message-198"');
    expect(html).toContain('data-message-id="message-202"');
    expect(html).toContain('aria-posinset="199"');
    expect(html).toContain('aria-posinset="203"');
    expect(html.match(/aria-setsize="400"/g)).toHaveLength(5);
    expect(html).not.toContain('data-message-id="message-0"');
    expect(html).not.toContain('data-message-id="message-399"');
    expect(html.match(/data-message-id=/g)).toHaveLength(5);
  });

  it("resolves an exact part deep link to its owning turn", () => {
    const turns = Array.from({ length: 400 }, (_, index) => turn(index));
    expect(replayTurnIndexForPart(turns, "part-350")).toBe(350);
    expect(replayTurnIndexForPart(turns, "missing")).toBe(-1);
  });

  it("loads specialised renderers, expands a targeted tool group, and renders assistant metrics once", () => {
    const parts: ReplayTurn["parts"] = [
      { id: "reason", data: { type: "reasoning", text: "trace", timeStart: 1, timeEnd: 2 } },
      ...["one", "two", "three"].map<ReplayTurn["parts"][number]>((id) => ({ id, data: { type: "tool", tool: "read", callId: id, status: "completed", input: {}, output: id, title: null, timeStart: 1, timeEnd: 2 } })),
      { id: "finish", data: { type: "step-finish", reason: "stop", cost: 0, tokens: null } },
    ];
    const value = {
      ...turn(1, "assistant"),
      durationMs: 1_250,
      timeCompleted: 1_252,
      cost: { amount: 2.5, priced: true },
      tokens: { input: 10, output: 2, reasoning: 3, cacheRead: 0, cacheWrite: 0 },
      parts,
    } satisfies ReplayTurn;
    const html = renderToStaticMarkup(<TurnCard turn={value} targetPartId="two" />);

    expect(html).toContain("Reasoning");
    expect(html).toContain("3 consecutive Read calls");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-part-id="two"');
    expect(html).toContain("Your configured cost");
    expect(html).toContain("Provider-reported cost");
    expect(html.match(/1\.3s/g)).toHaveLength(1);
  });

  it("waits boundedly for a virtual target that mounts after navigation", () => {
    const scheduled: Array<() => void> = [];
    const focus = vi.fn();
    const scrollIntoView = vi.fn();
    let mounted: HTMLElement | null = null;
    waitForReplayTarget(() => mounted, (callback) => scheduled.push(callback));

    expect(scheduled).toHaveLength(1);
    mounted = { focus, scrollIntoView } as unknown as HTMLElement;
    scheduled.shift()?.();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });

    const neverMounted: Array<() => void> = [];
    waitForReplayTarget(() => null, (callback) => neverMounted.push(callback));
    for (let index = 0; index < REPLAY_TARGET_MOUNT_ATTEMPTS; index += 1) neverMounted.shift()?.();
    expect(neverMounted).toHaveLength(0);
  });

  it("executes repeated jumps to the same turn instead of treating the index as state-only", () => {
    const turns = [turn(0), turn(1), turn(2)];
    const scrollToIndex = vi.fn();
    const target = { focus: vi.fn(), scrollIntoView: vi.fn() } as unknown as HTMLElement;

    scrollToReplayTurn(turns, 2, scrollToIndex, (messageId) => messageId === "message-2" ? target : null);
    scrollToReplayTurn(turns, 2, scrollToIndex, (messageId) => messageId === "message-2" ? target : null);

    expect(scrollToIndex).toHaveBeenCalledTimes(2);
    expect(scrollToIndex).toHaveBeenNthCalledWith(1, 2);
    expect(scrollToIndex).toHaveBeenNthCalledWith(2, 2);
  });

  it("waits for the first already-mounted row to become targeted and focusable, then repeats the same ref jump", () => {
    const turns = [turn(0), turn(1)];
    const scrollToIndex = vi.fn();
    const scheduled: Array<() => void> = [];
    const focus = vi.fn();
    const scrollIntoView = vi.fn();
    const mounted = {
      dataset: { messageId: "message-1" },
      tabIndex: 0,
      focus,
      scrollIntoView,
    } as unknown as HTMLElement;
    const root = { querySelectorAll: () => [mounted] } as unknown as ParentNode;

    scrollToReplayTurn(turns, 1, scrollToIndex, (messageId) => replayTurnFocusTarget(root, messageId), (callback) => scheduled.push(callback));
    expect(focus).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);

    mounted.dataset.targeted = "true";
    mounted.tabIndex = -1;
    scheduled.shift()?.();
    expect(focus).toHaveBeenCalledTimes(1);

    scrollToReplayTurn(turns, 1, scrollToIndex, (messageId) => replayTurnFocusTarget(root, messageId), (callback) => scheduled.push(callback));
    expect(scrollToIndex).toHaveBeenCalledTimes(2);
    expect(focus).toHaveBeenCalledTimes(2);
    expect(scheduled).toHaveLength(0);
  });
});

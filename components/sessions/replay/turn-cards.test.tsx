import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mockUseVirtualizer = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: mockUseVirtualizer }));

import type { ReplayTurn } from "@/types/oc";
import { REPLAY_WINDOW_OVERSCAN, replayTurnIndexForPart, TurnCard, WindowedTurnStream } from "./turn-cards";

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
});

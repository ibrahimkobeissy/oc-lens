import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { replayPartRenderer } from "./part-registry";
import { SessionEventCard } from "./session-event-card";
import { TurnCard } from "./turn-cards";
import { CompactionCard } from "./compaction-card";
import { decodeSessionEvent } from "@/lib/decode/session-event";
import { decodePartData } from "@/lib/decode/part";
import type { ReplayPart, ReplayTurn } from "@/types/oc";

function eventPart(kind: string, data: Record<string, unknown>): ReplayPart {
  return { id: `evt-${kind}`, data: decodeSessionEvent(kind, JSON.stringify(data)).value };
}

function eventTurn(part: ReplayPart): ReplayTurn {
  return { messageId: part.id, role: "event", agent: null, timeCreated: 1, timeCompleted: null, durationMs: null, tokens: null, cost: { amount: 0, priced: false }, parts: [part] };
}

describe("opencode 2.x session events in replay", () => {
  it("registers the session-event renderer", () => {
    expect(replayPartRenderer("session-event")).toBe(SessionEventCard);
  });

  it("renders an event turn as a marker, not as an assistant or unknown-role turn", () => {
    const part = eventPart("idle", { outcome: "succeeded", time: { created: 1 } });
    const html = renderToStaticMarkup(<TurnCard turn={eventTurn(part)} />);
    expect(html).toContain('aria-label="Session event"');
    expect(html).toContain("Session idle · succeeded");
    expect(html).not.toContain("Unknown role");
    expect(html).not.toContain("Assistant");
  });

  it("collapses a body behind <details> and flags a failed shell command", () => {
    const part = eventPart("shell", { command: "make", status: "completed", exit: 2, output: "boom", time: { created: 1 } });
    const html = renderToStaticMarkup(<SessionEventCard part={part} turn={eventTurn(part)} />);
    expect(html).toContain("<details");
    expect(html).toContain("Shell: make");
    expect(html).toContain("exit 2");
    expect(html).toContain("text-warning");
  });

  it("labels an unrecognised upstream record type instead of dropping it", () => {
    const decoded = decodeSessionEvent("checkpoint-v9", JSON.stringify({ time: { created: 1 } }));
    expect(decoded.warnings.map((w) => w.code)).toEqual(["unknown-session-event"]);
    const part = { id: "evt", data: decoded.value };
    expect(renderToStaticMarkup(<SessionEventCard part={part} turn={eventTurn(part)} />)).toContain("unrecognised · checkpoint-v9");
  });

  it("decodes a v2 compaction with no overflow record as null and never claims an overflow", () => {
    const decoded = decodePartData(JSON.stringify({ type: "compaction", auto: true }));
    expect(decoded.value).toEqual({ type: "compaction", auto: true, overflow: null, tailStartId: null });
    expect(decoded.warnings).toEqual([]);
    expect(decodePartData(JSON.stringify({ type: "compaction", auto: true, overflow: "yes" })).value.type).toBe("unknown");
    const part = { id: "c", data: decoded.value };
    expect(renderToStaticMarkup(<CompactionCard part={part} turn={eventTurn(part)} />)).not.toContain("context overflow");
  });
});

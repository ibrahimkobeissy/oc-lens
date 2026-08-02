import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PatchCard } from "./patch-card";
import { replayPartRenderer } from "./part-registry";
import { decodePartData } from "@/lib/decode/part";
import type { ReplayPart, ReplayTurn } from "@/types/oc";

function part(overrides: Partial<Extract<ReplayPart["data"], { type: "patch" }>> = {}): ReplayPart {
  return {
    id: "patch-part",
    data: { type: "patch", hash: "094c0ec1231b737617bded055272857a3c644f8a", files: ["/repo/a.ts", "/repo/b.ts"], ...overrides },
  };
}

function turn(): ReplayTurn {
  return {
    messageId: "message",
    role: "assistant",
    agent: "build",
    timeCreated: 1,
    timeCompleted: 2,
    durationMs: 1,
    tokens: null,
    cost: { amount: 0, priced: false },
    parts: [],
  };
}

describe("PatchCard", () => {
  it("registers the verified patch renderer and stays collapsed by default", () => {
    expect(replayPartRenderer("patch")).toBe(PatchCard);
    const html = renderToStaticMarkup(<PatchCard part={part()} turn={turn()} />);

    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
    expect(html).toContain("Workspace diff snapshot");
    expect(html).toContain("2 files");
    expect(html).toContain("094c0ec1");
    expect(html).toContain("/repo/a.ts");
    expect(html).toContain("/repo/b.ts");
  });

  it("never implies these files were changed by this session — this is a workspace-wide, not session-scoped, snapshot", () => {
    const html = renderToStaticMarkup(<PatchCard part={part()} turn={turn()} />);
    expect(html).toMatch(/not necessarily/i);
    expect(html).not.toMatch(/this session (changed|touched|edited)/i);
  });

  it("pluralizes the file count correctly for exactly one file", () => {
    expect(renderToStaticMarkup(<PatchCard part={part({ files: ["/repo/a.ts"] })} turn={turn()} />)).toContain("1 file<");
  });

  it("decodes a real patch sample end to end through the registry", () => {
    const decoded = decodePartData(JSON.stringify({ type: "patch", hash: "abc123", files: ["/real/file.ts"] }));
    expect(decoded.value).toEqual({ type: "patch", hash: "abc123", files: ["/real/file.ts"] });
    const Renderer = replayPartRenderer(decoded.value.type);
    const html = renderToStaticMarkup(<Renderer part={{ id: "real-patch", data: decoded.value }} turn={turn()} />);
    expect(html).toContain("/real/file.ts");
  });
});

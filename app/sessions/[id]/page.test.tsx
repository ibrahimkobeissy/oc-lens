import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  replayMode: "success",
  filesMode: "success",
  replayWarnings: [] as Array<{ code: string; message: string; count: number }>,
  fileWarnings: [] as Array<{ code: string; message: string; count: number }>,
  calls: [] as Array<{ route: string; enabled: boolean | undefined }>,
  filesMutate: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "ses/one" }),
  useSearchParams: () => ({ get: () => null }),
}));
vi.mock("@/components/sessions/replay/session-sidebar", () => ({ SessionSidebar: () => <div>sidebar marker</div> }));
vi.mock("@/components/sessions/replay/token-accumulation-chart", () => ({ TokenAccumulationChart: () => <div>chart marker</div> }));
vi.mock("@/components/sessions/replay/turn-cards", () => ({
  WindowedTurnStream: () => <div>turn stream marker</div>,
}));

const meta = { generatedAt: 1, schemaVersion: "opencode-1.17.7", warnings: [] };
const replayData = {
  session: {
    id: "ses/one", slug: "one", title: "Replay One", projectId: "project", projectDisplayName: "Project", directory: "/repo",
    agent: "build", model: null, version: "1.17.7", timeCreated: 1_000, timeUpdated: 2_000, durationMs: 1_000, timeArchived: null,
    parentId: null, messageCounts: { user: 0, assistant: 0 }, toolCallCount: 0, errorCount: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cost: { amount: 0, priced: false },
    hasReasoning: false, hasCompaction: false, usesMcp: false, usesSubagent: false, usesWebfetch: false,
  },
  parentId: null,
  childIds: [],
  turns: [],
  tokenAccumulation: [],
};

vi.mock("@/hooks/use-oc", () => ({
  useOc: (route: string, options: { enabled?: boolean } = {}) => {
    state.calls.push({ route, enabled: options.enabled });
    if (route.endsWith("/replay")) {
      if (state.replayMode === "loading") return { data: undefined, error: undefined, isLoading: true, mutate: vi.fn() };
      if (state.replayMode === "error") return { data: undefined, error: { message: "replay failed" }, isLoading: false, mutate: vi.fn() };
      return { data: { data: replayData, meta: { ...meta, warnings: state.replayWarnings } }, error: undefined, isLoading: false, mutate: vi.fn() };
    }
    if (route.endsWith("/tree")) return { data: undefined, error: undefined, isLoading: false, mutate: vi.fn() };
    if (state.filesMode === "loading") return { data: undefined, error: undefined, isLoading: true, mutate: state.filesMutate };
    if (state.filesMode === "error") return { data: undefined, error: { message: "files failed" }, isLoading: false, mutate: state.filesMutate };
    const changes = state.filesMode === "empty" ? [] : [{ sessionId: "ses/one", filePath: "/repo/src/a.ts", tool: "write", timeCreated: 1_500, partId: "part/one" }];
    const warnings = state.fileWarnings.length > 0 ? state.fileWarnings : state.filesMode === "warning" ? [{ code: "file-caveat", message: "File caveat", count: 1 }] : [];
    return { data: { data: { changes, projectWorktree: "/repo" }, meta: { ...meta, warnings } }, error: undefined, isLoading: false, mutate: state.filesMutate };
  },
}));

import SessionReplayPage, { dedupeReplayWarnings } from "./page";

describe("OCL-103 replay file-timeline integration", () => {
  beforeEach(() => {
    state.replayMode = "success";
    state.filesMode = "success";
    state.replayWarnings = [];
    state.fileWarnings = [];
    state.calls.length = 0;
    state.filesMutate.mockReset();
  });

  it("fetches the encoded typed files route only after replay succeeds and renders it coherently", () => {
    const html = renderToStaticMarkup(<SessionReplayPage />);
    expect(state.calls).toContainEqual({ route: "/api/sessions/ses%2Fone/files", enabled: true });
    expect(html).toContain("File changes");
    expect(html).toContain("src/a.ts");
    expect(html.indexOf("File changes")).toBeLessThan(html.indexOf("chart marker"));
  });

  it("keeps the files request paused while replay is loading", () => {
    state.replayMode = "loading";
    const html = renderToStaticMarkup(<SessionReplayPage />);
    expect(state.calls).toContainEqual({ route: "/api/sessions/ses%2Fone/files", enabled: false });
    expect(html).toContain("Loading session replay");
  });

  it("keeps the files request paused when replay fails", () => {
    state.replayMode = "error";
    const html = renderToStaticMarkup(<SessionReplayPage />);
    expect(state.calls).toContainEqual({ route: "/api/sessions/ses%2Fone/files", enabled: false });
    expect(html).toContain("replay failed");
  });

  it("renders file loading and retryable error states locally", () => {
    state.filesMode = "loading";
    expect(renderToStaticMarkup(<SessionReplayPage />)).toContain('aria-label="Loading file timeline"');
    state.filesMode = "error";
    const html = renderToStaticMarkup(<SessionReplayPage />);
    expect(html).toContain("File timeline could not be loaded");
    expect(html).toContain("files failed");
    expect(html).toContain("Retry");
    expect(html).toContain("chart marker");
  });

  it("always renders successful empty data and file warnings", () => {
    state.filesMode = "empty";
    expect(renderToStaticMarkup(<SessionReplayPage />)).toContain("No verified file touches");
    state.filesMode = "warning";
    expect(renderToStaticMarkup(<SessionReplayPage />)).toContain("File caveat");
  });

  it("dedupes overlapping envelope warnings into one banner without summing counts", () => {
    expect(dedupeReplayWarnings(
      [{ code: "shared", message: "Replay evidence", count: 2 }],
      [{ code: "shared", message: "Tree evidence", count: 3 }],
      [{ code: "shared", message: "File evidence", count: 5 }],
    )).toEqual([{ code: "shared", message: "Replay evidence", count: 5 }]);

    state.replayWarnings = [{ code: "shared", message: "Replay evidence", count: 2 }];
    state.fileWarnings = [{ code: "shared", message: "File evidence", count: 5 }];
    const html = renderToStaticMarkup(<SessionReplayPage />);
    expect(html.match(/Data caveats/g)).toHaveLength(1);
    expect(html).toContain("Replay evidence");
    expect(html).toContain("(5)");
    expect(html).not.toContain("File evidence");
  });
});

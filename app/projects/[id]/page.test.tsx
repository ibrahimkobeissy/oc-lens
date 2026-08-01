import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ mode: "success", route: "", mutate: vi.fn() }));

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "project/one" }) }));
vi.mock("@/components/projects/project-detail", () => ({
  ProjectDetail: ({ project, timeZone }: { project: { displayName: string }; timeZone: string }) => <div>Detail marker: {project.displayName} in {timeZone}</div>,
}));
vi.mock("@/hooks/use-oc", () => ({
  useOc: (route: string) => {
    state.route = route;
    if (state.mode === "loading") return { data: undefined, error: undefined, isLoading: true, mutate: state.mutate };
    if (state.mode === "database") return { data: undefined, error: { message: "missing", isDatabaseNotFound: true, isSchemaMismatch: false }, isLoading: false, mutate: state.mutate };
    if (state.mode === "schema") return { data: undefined, error: { message: "wrong shape", isDatabaseNotFound: false, isSchemaMismatch: true }, isLoading: false, mutate: state.mutate };
    if (state.mode === "error") return { data: undefined, error: { message: "route failed", isDatabaseNotFound: false, isSchemaMismatch: false }, isLoading: false, mutate: state.mutate };
    return { data: { data: { displayName: "Project One" }, meta: { generatedAt: 1, schemaVersion: "opencode-1.17.7", warnings: [] } }, error: undefined, isLoading: false, mutate: state.mutate };
  },
}));

import ProjectDetailPage from "./page";

describe("OCL-062 ProjectDetailPage states", () => {
  beforeEach(() => { state.mode = "success"; state.route = ""; state.mutate.mockReset(); });

  it("requests the encoded project route and renders the detail response", () => {
    const html = renderToStaticMarkup(<ProjectDetailPage />);
    expect(state.route).toBe("/api/projects/project%2Fone?tz=UTC");
    expect(html).toContain("Detail marker: Project One");
    expect(html).toContain("in UTC");
  });

  it("renders a labelled loading state", () => {
    state.mode = "loading";
    const html = renderToStaticMarkup(<ProjectDetailPage />);
    expect(html).toContain('aria-label="Loading project detail"');
  });

  it("renders onboarding and schema refusal states", () => {
    state.mode = "database";
    expect(renderToStaticMarkup(<ProjectDetailPage />)).toContain("Connect your opencode history");
    state.mode = "schema";
    expect(renderToStaticMarkup(<ProjectDetailPage />)).toContain("This database is not compatible");
  });

  it("renders an honest retryable route error", () => {
    state.mode = "error";
    const html = renderToStaticMarkup(<ProjectDetailPage />);
    expect(html).toContain("Project unavailable");
    expect(html).toContain("route failed");
    expect(html).toContain("Retry");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mockUseOc = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-oc", () => ({ useOc: mockUseOc }));

import { StorageContent, StoragePanel, formatBytes } from "./storage-panel";

describe("StoragePanel", () => {
  it("formats byte values without NaN or Infinity", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1_536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1_024 * 1_024)).toBe("5.0 MB");
  });

  it("renders every component, the total, and honest missing-directory dashes", () => {
    const markup = renderToStaticMarkup(
      <StorageContent storage={{ dbBytes: 1_024, walBytes: 0, logBytes: null, reposBytes: 512, totalBytes: 1_536 }} />,
    );

    for (const label of ["opencode.db", "opencode.db-wal", "log/", "repos/", "Total footprint"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("1.5 KB");
    expect(markup).toContain(">—<");
    expect(markup).toContain("0 B");
    expect(markup).not.toMatch(/NaN|Infinity|delete|cleanup/i);
  });

  it("renders an explanatory empty state without a cleanup affordance", () => {
    const markup = renderToStaticMarkup(
      <StorageContent storage={{ dbBytes: 0, walBytes: 0, logBytes: null, reposBytes: null, totalBytes: 0 }} />,
    );

    expect(markup).toContain("No storage footprint available");
    expect(markup).toContain("optional log and repository directories are not present");
    expect(markup).not.toMatch(/button|delete|cleanup/i);
  });

  it("renders stable loading, error, and no-response states", () => {
    mockUseOc.mockReturnValue({ data: undefined, error: undefined, isLoading: true, mutate: vi.fn() });
    expect(renderToStaticMarkup(<StoragePanel />)).toContain("Loading storage footprint");

    mockUseOc.mockReturnValue({ data: undefined, error: new Error("private path must not render"), isLoading: false, mutate: vi.fn() });
    const errorMarkup = renderToStaticMarkup(<StoragePanel />);
    expect(errorMarkup).toContain("Storage footprint is temporarily unavailable.");
    expect(errorMarkup).toContain("Retry");
    expect(errorMarkup).not.toContain("private path must not render");

    mockUseOc.mockReturnValue({ data: undefined, error: undefined, isLoading: false, mutate: vi.fn() });
    expect(renderToStaticMarkup(<StoragePanel />)).toContain("No storage response is available yet.");
  });
});

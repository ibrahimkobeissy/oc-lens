import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { absoluteFilePath, FileTimeline, relativeFilePath } from "./file-timeline";
import type { FileChangeSummary } from "@/types/oc";

const changes: FileChangeSummary[] = [
  { sessionId: "ses/one", filePath: "/repo/src/a file.ts", tool: "write", timeCreated: 1_000, partId: "part/one" },
  { sessionId: "ses/one", filePath: "/repo/tests/a.test.ts", tool: "edit", timeCreated: 2_000, partId: "part-two" },
];

describe("FileTimeline", () => {
  it("renders an empty state instead of an empty timeline frame", () => {
    const html = renderToStaticMarkup(<FileTimeline changes={[]} projectWorktree="/repo" />);
    expect(html).toContain("No verified file touches");
    expect(html).toContain("missing path evidence");
    expect(html).not.toContain("<ol");
  });

  it("shows worktree-relative paths with absolute hover evidence and exact replay links", () => {
    const html = renderToStaticMarkup(<FileTimeline changes={changes} projectWorktree="/repo" />);
    expect(html).toContain("src/a file.ts");
    expect(html).toContain('title="/repo/src/a file.ts"');
    expect(html).toContain('/sessions/ses%2Fone?part=part%2Fone#part-part%2Fone');
    expect(html).toContain("Write");
    expect(html).toContain("Edit");
    expect(html.indexOf("src/a file.ts")).toBeLessThan(html.indexOf("tests/a.test.ts"));
  });

  it("computes honest relative paths across nested, outside, root, and drive-mismatch locations", () => {
    expect(relativeFilePath("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
    expect(relativeFilePath("/other/a.ts", "/repo/packages/app")).toBe("../../../other/a.ts");
    expect(relativeFilePath("/repo/a.ts", "/")).toBe("repo/a.ts");
    expect(relativeFilePath("D:\\src\\a.ts", "C:\\repo")).toBe("D:\\src\\a.ts");
  });

  it("resolves relative evidence against the worktree before using it as the absolute tooltip", () => {
    expect(absoluteFilePath("src/../lib/a.ts", "/repo")).toBe("/repo/lib/a.ts");
    const relativeChange = [{ ...changes[0]!, filePath: "src/a.ts" }];
    const html = renderToStaticMarkup(<FileTimeline changes={relativeChange} projectWorktree="/repo" />);
    expect(html).toContain('title="/repo/src/a.ts"');
    expect(html).toContain("src/a.ts");
  });
});

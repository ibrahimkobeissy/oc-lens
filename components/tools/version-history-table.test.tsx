import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { semverSortedVersions, VersionHistoryTable } from "@/components/tools/version-history-table";
import type { VersionRecord } from "@/types/oc";

const versions = [
  { version: "1.17.7", sessionCount: 2, messageCount: 4, firstSeen: 2, lastSeen: 3 },
  { version: "1.9.0", sessionCount: 1, messageCount: 2, firstSeen: 1, lastSeen: 1 },
] satisfies VersionRecord[];

describe("OCL-076 version history", () => {
  it("sorts semantic numeric segments rather than lexicographic strings", () => {
    expect(semverSortedVersions(versions).map((version) => version.version)).toEqual(["1.9.0", "1.17.7"]);
  });

  it("renders the exact supplied session and message totals", () => {
    const html = renderToStaticMarkup(<VersionHistoryTable versions={versions} />);
    expect(html.indexOf("1.9.0")).toBeLessThan(html.indexOf("1.17.7"));
    expect(html).toContain(">4</td>");
  });
});

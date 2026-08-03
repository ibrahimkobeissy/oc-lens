import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { aggregateWarnings, buildReportIssueUrl, WarningsBanner } from "./warnings-banner";
import type { OcWarning } from "@/types/oc";

describe("aggregateWarnings", () => {
  it("merges repeated codes, sums counts, and keeps distinct messages", () => {
    const warnings: OcWarning[] = [
      { code: "unknown-agent", message: "Unrecognised agent: foo", count: 2 },
      { code: "unknown-agent", message: "Unrecognised agent: bar", count: 1 },
      { code: "malformed-session-model", message: "session.model did not match the expected shape", count: 7 },
    ];
    const result = aggregateWarnings(warnings);
    expect(result).toEqual([
      { code: "malformed-session-model", message: "session.model did not match the expected shape", count: 7, messages: ["session.model did not match the expected shape"] },
      { code: "unknown-agent", message: "Unrecognised agent: foo", count: 3, messages: ["Unrecognised agent: foo", "Unrecognised agent: bar"] },
    ]);
  });
});

describe("buildReportIssueUrl", () => {
  const warnings = aggregateWarnings([
    { code: "unknown-part-type", message: "Unrecognised part.data.type: file", count: 3 },
    { code: "malformed-session-model", message: "session.model did not match the expected {id,providerID,variant} shape", count: 7 },
  ]);

  it("points at the project's issues page with a pre-filled title and body", () => {
    const url = buildReportIssueUrl(warnings, "opencode-1.17.7");
    expect(url.startsWith("https://github.com/ibrahimkobeissy/oc-lens/issues/new?")).toBe(true);

    const params = new URL(url).searchParams;
    expect(params.get("title")).toBe("Data shape mismatch: malformed-session-model, unknown-part-type");
    const body = params.get("body") ?? "";
    expect(body).toContain("opencode-1.17.7");
    expect(body).toContain("`unknown-part-type`: Unrecognised part.data.type: file (3)");
    expect(body).toContain("`malformed-session-model`: session.model did not match the expected {id,providerID,variant} shape (7)");
  });

  it("never includes anything beyond warning codes/messages/counts and the schema version", () => {
    const url = buildReportIssueUrl(warnings, "opencode-1.17.7");
    const body = new URL(url).searchParams.get("body") ?? "";
    expect(body).not.toMatch(/ses_[a-z0-9]+/i);
    expect(body).not.toMatch(/\/home\/|\/Users\//);
  });
});

describe("WarningsBanner", () => {
  it("renders nothing when there are no warnings", () => {
    expect(renderToStaticMarkup(<WarningsBanner warnings={[]} />)).toBe("");
  });

  it("renders the caveats list and a report trigger button", () => {
    const html = renderToStaticMarkup(
      <WarningsBanner warnings={[{ code: "unknown-part-type", message: "Unrecognised part.data.type: file", count: 3 }]} />,
    );
    expect(html).toContain("Data caveats");
    expect(html).toContain("Unrecognised part.data.type: file");
    expect(html).toContain("(3)");
    expect(html).toContain("Report on GitHub");
  });
});

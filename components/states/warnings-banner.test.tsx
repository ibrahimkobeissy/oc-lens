import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { aggregateWarnings, buildReportIssueUrl, WarningsBanner, type WarningSample } from "./warnings-banner";
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

  it("says so plainly when no raw example is available for a warning", () => {
    const url = buildReportIssueUrl(warnings, "opencode-1.17.7");
    const body = new URL(url).searchParams.get("body") ?? "";
    expect(body).toContain("No raw example included");
  });

  it("embeds a found raw sample verbatim, with its source id and a note it's real data", () => {
    const samples: Record<string, WarningSample> = {
      "unknown-part-type": { code: "unknown-part-type", found: true, sourceId: "prt_00001a", raw: '{\n  "type": "file"\n}', truncated: false },
    };
    const url = buildReportIssueUrl(warnings, "opencode-1.17.7", samples);
    const body = new URL(url).searchParams.get("body") ?? "";
    expect(body).toContain("prt_00001a");
    expect(body).toContain('"type": "file"');
    expect(body).toMatch(/remove it|delete anything/i);
    // The other warning had no sample supplied, so it still gets the honest fallback note.
    expect(body).toContain("No raw example included");
  });

  it("notes truncation when the raw sample was cut down for size", () => {
    const samples: Record<string, WarningSample> = {
      "unknown-part-type": { code: "unknown-part-type", found: true, sourceId: "prt_00001a", raw: "…(truncated)", truncated: true },
    };
    const url = buildReportIssueUrl(warnings, "opencode-1.17.7", samples);
    const body = new URL(url).searchParams.get("body") ?? "";
    expect(body).toMatch(/truncated/i);
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

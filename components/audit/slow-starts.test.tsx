import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { replayFailureMarks, SlowStartBanner } from "@/components/sessions/replay/failure-marks";
import type { SlowStartReport, SlowStep } from "@/lib/audit/slow-start-types";
import { SlowStarts } from "./slow-starts";

const step: SlowStep = { messageId: "m1", sessionId: "ses_1", sessionTitle: "Ticket work", timeCreated: 1_000, model: "custom-proxy/custom-model", waitSeconds: 127, baselineSeconds: 6.8 };
const report: SlowStartReport = { measurable: true, byDay: [{ date: "2026-10-28", steps: 221, medianSeconds: 11.5, p90Seconds: 44.3, slowSteps: 48 }], slowSteps: [step] };

describe("slow starts", () => {
  it("shows waits per day and the slowest steps, worded as possible retries, never errors", () => {
    const html = renderToStaticMarkup(<SlowStarts report={report} />);
    for (const text of ["Slow starts — possible hidden retries or slow provider", "2026-10-28", "11.5 s", "48", "2m 7s", "19× usual 6.8 s", "Ticket work"]) expect(html).toContain(text);
    expect(html).not.toMatch(/error|failed/i);
  });

  it("says when timing was not recorded rather than showing an all-clear", () => {
    expect(renderToStaticMarkup(<SlowStarts report={{ measurable: false, byDay: [], slowSteps: [] }} />)).toContain("Not measurable");
  });

  it("marks the slow step in the replay", () => {
    const marks = replayFailureMarks(undefined, [step]);
    const html = renderToStaticMarkup(<SlowStartBanner step={marks.slowStarts.get("m1")} />);
    expect(html).toContain("Slow start: waited 2m 7s for the first token");
    expect(html).toContain("19× this model");
    expect(html).toContain("Possible hidden retries or a slow provider");
    expect(renderToStaticMarkup(<SlowStartBanner step={undefined} />)).toBe("");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SkillSummary } from "@/types/oc";
import { rankedSkills, SkillRankingChart } from "./skill-ranking-chart";

const skills: SkillSummary[] = [
  { skill: "unknown", totalCalls: 1, sessionCount: 1, errorCount: 1, p50DurationMs: null, p95DurationMs: null },
  { skill: "review", totalCalls: 10, sessionCount: 4, errorCount: 2, p50DurationMs: 500, p95DurationMs: 2_500 },
];

describe("SkillRankingChart", () => {
  it("ranks calls and derives finite rates", () => { expect(rankedSkills(skills)).toMatchObject([{ skill: "review", successPct: 0.8, errorPct: 0.2 }, { skill: "unknown", successPct: 0, errorPct: 1 }]); });
  it("renders unknown, outcome rates, and durations", () => { const html = renderToStaticMarkup(<SkillRankingChart skills={skills} />); expect(html).toContain("/review"); expect(html).toContain("/unknown"); expect(html).toContain("80.0%"); expect(html).toContain("20.0%"); expect(html).toContain("500ms"); expect(html).toContain("2.5s"); expect(html).toContain(">—<"); expect(html).not.toMatch(/NaN|Infinity/); });
  it("renders an explanatory empty state", () => { expect(renderToStaticMarkup(<SkillRankingChart skills={[]} />)).toContain("No skill invocations"); });
});

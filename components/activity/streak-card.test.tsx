import { DatabaseSync } from "node:sqlite";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mockUseOc = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-oc", () => ({ useOc: mockUseOc }));

import ActivityPage from "@/app/activity/page";
import { streaks } from "@/lib/queries/activity";
import { FIXTURE_SCHEMA_SQL } from "@/test/fixtures/schema";
import type { StreakSummary } from "@/types/oc";
import { StreakCard } from "./streak-card";

function database(...times: number[]): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(FIXTURE_SCHEMA_SQL);
  const insert = db.prepare(
    "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (?, 'global', ?, '/', ?, '1', ?, ?)",
  );
  times.forEach((time, index) => insert.run(`session-${index}`, `session-${index}`, `Session ${index}`, time, time));
  return db;
}

function render(summary: StreakSummary): string {
  return renderToStaticMarkup(<StreakCard streaks={summary} locale="en-US" />);
}

describe("StreakCard", () => {
  it("renders streak maths across a month boundary", () => {
    const db = database(
      Date.UTC(2026, 0, 30, 12),
      Date.UTC(2026, 0, 31, 12),
      Date.UTC(2026, 1, 1, 12),
      Date.UTC(2026, 1, 2, 12),
    );

    const summary = streaks(db, "UTC", Date.UTC(2026, 1, 2, 18)).data;
    const markup = render(summary);

    expect(summary).toMatchObject({ currentStreakDays: 4, longestStreakDays: 4 });
    expect(markup).toContain("Jan 30, 2026 – Feb 2, 2026");
    expect(markup).toContain("Consecutive active days ending today");
    db.close();
  });

  it("keeps local dates consecutive across the Europe/Paris DST transition", () => {
    const db = database(
      Date.UTC(2026, 2, 28, 23, 30),
      Date.UTC(2026, 2, 29, 22, 30),
      Date.UTC(2026, 2, 30, 22, 30),
    );

    const summary = streaks(db, "Europe/Paris", Date.UTC(2026, 2, 31, 12)).data;

    expect(summary).toMatchObject({
      currentStreakDays: 3,
      longestStreakDays: 3,
      longestStreakStart: "2026-03-29",
      longestStreakEnd: "2026-03-31",
    });
    expect(render(summary)).toContain("Mar 29, 2026 – Mar 31, 2026");
    db.close();
  });

  it("labels a streak broken today honestly while preserving it as the longest", () => {
    const db = database(Date.UTC(2026, 1, 27, 12), Date.UTC(2026, 1, 28, 12));

    const summary = streaks(db, "UTC", Date.UTC(2026, 2, 1, 12)).data;
    const markup = render(summary);

    expect(summary).toMatchObject({ currentStreakDays: 0, longestStreakDays: 2 });
    expect(markup).toContain("No active streak today");
    expect(markup).toContain("Feb 27, 2026 – Feb 28, 2026");
    db.close();
  });

  it("shows zero values and an explanatory state when there is no activity", () => {
    const db = database();
    const summary = streaks(db, "UTC", Date.UTC(2026, 0, 1, 12)).data;
    const markup = render(summary);

    expect(markup).toContain("Current streak");
    expect(markup).toContain("Longest streak");
    expect(markup).toContain("Active days");
    expect(markup.match(/>0<\/p>/g)).toHaveLength(3);
    expect(markup).toContain("No activity yet");
    expect(markup).toContain("Streaks will appear after an opencode session is recorded in this range.");
    db.close();
  });

  it("keeps the zero-valued streak card reachable in the activity page empty state", () => {
    mockUseOc.mockReturnValue({
      data: {
        data: {
          dailyActivity: [],
          hourOfDay: Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 })),
          dayOfWeek: Array.from({ length: 7 }, (_, day) => ({ day, count: 0 })),
          streaks: {
            currentStreakDays: 0,
            longestStreakDays: 0,
            longestStreakStart: null,
            longestStreakEnd: null,
            mostActiveDay: null,
            totalActiveDays: 0,
            firstSessionDate: null,
          },
        },
        meta: { generatedAt: 0, schemaVersion: "test", warnings: [] },
      },
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    });

    const markup = renderToStaticMarkup(<ActivityPage />);
    expect(markup).toContain("Streaks and active days");
    expect(markup).toContain("No activity yet");
    expect(markup).toContain("No activity in this range");
  });
});

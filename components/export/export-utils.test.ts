import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import type { ExportResponse } from "@/types/oc";
import { createExportZip, exportManifest, exportUrl, previewText } from "./export-utils";

function response(): ExportResponse {
  return {
    generatedAt: Date.UTC(2026, 7, 1, 12),
    schemaVersion: "2026-08-01",
    rangeFrom: Date.UTC(2026, 6, 1),
    rangeTo: Date.UTC(2026, 7, 1),
    counts: { sessions: 2, messages: 5, parts: 9, todos: 1 },
    sessions: [],
    activity: { dailyActivity: [], hourOfDay: [], dayOfWeek: [], streaks: { currentStreakDays: 0, longestStreakDays: 0, longestStreakStart: null, longestStreakEnd: null, mostActiveDay: null, totalActiveDays: 0, firstSessionDate: null } },
    todos: { sessions: [], rollup: { pending: 0, inProgress: 0, completed: 0, unknown: 0 } },
  };
}

describe("export helpers", () => {
  it("builds a live preview URL from scopes, inclusive calendar dates, and timezone", () => {
    expect(exportUrl(
      ["sessions", "activity"],
      { from: new Date(2026, 6, 1, 12), to: new Date(2026, 6, 31, 12) },
      "Europe/Paris",
      true,
    )).toBe("/api/export?preview=1&scope=sessions%2Cactivity&from=2026-07-01&to=2026-07-31&tz=Europe%2FParis");
  });

  it("describes counts according to each selected dataset", () => {
    const counts = response().counts;
    expect(previewText("sessions", counts)).toBe("2 sessions");
    expect(previewText("tools", counts)).toBe("9 parts scanned");
    expect(previewText("replay", counts)).toBe("5 turns · 9 parts");
  });

  it("creates one file per selected dataset plus a complete manifest", async () => {
    const data = response();
    const blob = await createExportZip(data, ["sessions", "activity", "todos"]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    expect(Object.keys(zip.files).sort()).toEqual(["activity.json", "manifest.json", "sessions.json", "todos.json"]);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as ReturnType<typeof exportManifest>;
    expect(manifest).toEqual({
      schemaVersion: "2026-08-01",
      generatedAt: Date.UTC(2026, 7, 1, 12),
      generatedAtIso: "2026-08-01T12:00:00.000Z",
      range: { from: Date.UTC(2026, 6, 1), to: Date.UTC(2026, 7, 1) },
      counts: { sessions: 2, messages: 5, parts: 9, todos: 1 },
      scopes: ["sessions", "activity", "todos"],
    });
    expect(JSON.parse(await zip.file("sessions.json")!.async("string"))).toEqual([]);
  });
});

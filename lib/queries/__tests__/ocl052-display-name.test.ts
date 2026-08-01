import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { FIXTURE_SCHEMA_SQL } from "@/test/fixtures/schema";
import { getReplay } from "../replay";

describe("OCL-052 replay project display name", () => {
  it("uses project name before the global fallback", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    db.prepare("INSERT INTO project (id, worktree, name) VALUES ('global', '/', 'Named global')").run();
    db.prepare(
      "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('session', 'global', 'session', '/', 'Session', '1', 1, 2)",
    ).run();

    expect(getReplay(db, "session").data?.session.projectDisplayName).toBe("Named global");
    db.close();
  });
});

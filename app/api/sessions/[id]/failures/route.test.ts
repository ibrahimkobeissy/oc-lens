import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanupTempDir, makeTempDir } from "@/lib/db/__tests__/test-db";
import { resetConnectionForTests } from "@/lib/db/connection";
import type { SessionFailureReport } from "@/lib/audit/failure-types";
import { buildV2Fixture, V2_MAIN_SESSION } from "@/test/fixtures/v2-fixture";

import { dynamic, GET } from "./route";

const dir = makeTempDir();
const originalDb = process.env.OC_LENS_DB;

function call(id: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/sessions/${encodeURIComponent(id)}/failures`), { params: Promise.resolve({ id }) });
}

beforeAll(() => {
  const path = join(dir, "v2.db");
  buildV2Fixture(path);
  process.env.OC_LENS_DB = path;
  resetConnectionForTests();
});

afterAll(() => {
  if (originalDb === undefined) delete process.env.OC_LENS_DB;
  else process.env.OC_LENS_DB = originalDb;
  resetConnectionForTests();
  cleanupTempDir(dir);
});

describe("GET /api/sessions/[id]/failures", () => {
  it("returns an empty report for a session without failures", async () => {
    const response = await call(V2_MAIN_SESSION);
    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: SessionFailureReport };
    expect(body.data.incidents).toEqual([]);
    expect(body.data.overhead).toMatchObject({ failedCalls: 0, cacheLostTokens: 0, repeatedCalls: 0 });
  });

  it("404s an unknown session and 400s an invalid id", async () => {
    expect((await call("ses_missing")).status).toBe(404);
    expect((await call("bad\u0000id")).status).toBe(400);
  });
});

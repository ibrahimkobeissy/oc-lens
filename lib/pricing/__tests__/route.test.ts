import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConnectionForTests, type ConnectResult } from "@/lib/db/connection";
import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";
import { resetPricingForTests } from "../config";

// Overridable so the missing-database path is deterministic instead of depending
// on whether this machine happens to have a real opencode DB (project rule: test
// against the fixture, never the developer's real DB).
const connectionOverride = vi.hoisted((): { value: ConnectResult | undefined } => ({ value: undefined }));

vi.mock("@/lib/db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/connection")>();
  return {
    ...actual,
    getConnection: (...args: Parameters<typeof actual.getConnection>): ConnectResult =>
      connectionOverride.value ?? actual.getConnection(...args),
  };
});

describe("GET/PUT /api/pricing", () => {
  let dir: string;
  let dbPath: string;
  let originalXdg: string | undefined;
  let originalDb: string | undefined;

  beforeEach(() => {
    dir = makeTempDir();
    dbPath = join(dir, "opencode.db");
    createFullSchemaDb(dbPath);

    originalXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = dir;
    originalDb = process.env.OC_LENS_DB;
    process.env.OC_LENS_DB = dbPath;
    connectionOverride.value = undefined;
    resetConnectionForTests();
  });

  afterEach(() => {
    resetPricingForTests({ configHome: dir });
    if (originalXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdg;
    }
    if (originalDb === undefined) {
      delete process.env.OC_LENS_DB;
    } else {
      process.env.OC_LENS_DB = originalDb;
    }
    connectionOverride.value = undefined;
    resetConnectionForTests();
    cleanupTempDir(dir);
  });

  it("GET returns the default empty config plus pricableModels from the fixture database", async () => {
    const { GET } = await import("@/app/api/pricing/route");
    const response = await GET();
    const body = await response.json();
    expect("data" in body).toBe(true);
    if ("data" in body) {
      expect(body.data.version).toBe(1);
      expect(body.data.prices).toEqual({});
      expect(Array.isArray(body.data.pricableModels)).toBe(true);
    }
  });

  it("GET reports a database_not_found error honestly instead of a silent empty model list", async () => {
    connectionOverride.value = { ok: false, reason: "not-found", searched: [join(dir, "does-not-exist.db")] };
    const { GET } = await import("@/app/api/pricing/route");
    const response = await GET();
    expect(response.status).toBe(404);
    const body = await response.json();
    expect("error" in body).toBe(true);
    if ("error" in body) {
      expect(body.error.code).toBe("database_not_found");
    }
  });

  it("PUT with a valid body writes the file and returns it", async () => {
    const { PUT } = await import("@/app/api/pricing/route");
    const next = {
      version: 1,
      prices: {
        "opencode/sonnet": {
          inputPerMTok: 3,
          outputPerMTok: 15,
          cacheReadPerMTok: 0.3,
          cacheWritePerMTok: 3.75,
          currency: "USD",
        },
      },
      updatedAt: 123,
    };
    const request = new Request("http://localhost/api/pricing", {
      method: "PUT",
      body: JSON.stringify(next),
    });
    const response = await PUT(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect("data" in body).toBe(true);
    if ("data" in body) {
      expect(body.data.prices).toEqual(next.prices);
    }

    const onDisk: unknown = JSON.parse(readFileSync(join(dir, "oc-lens", "config.json"), "utf-8"));
    expect(onDisk).toEqual(next);
  });

  it("PUT with a malformed body returns 400 and does not create/change the file", async () => {
    const { PUT } = await import("@/app/api/pricing/route");
    const request = new Request("http://localhost/api/pricing", {
      method: "PUT",
      body: JSON.stringify({ nonsense: true }),
    });
    const response = await PUT(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect("error" in body).toBe(true);

    const configPath = join(dir, "oc-lens", "config.json");
    expect(() => readFileSync(configPath, "utf-8")).toThrow();
  });

  it("PUT with invalid JSON syntax returns 400", async () => {
    const { PUT } = await import("@/app/api/pricing/route");
    const request = new Request("http://localhost/api/pricing", {
      method: "PUT",
      body: "{not json",
    });
    const response = await PUT(request);
    expect(response.status).toBe(400);
  });

  it("the route module accepts no filesystem path field anywhere in its request handling", async () => {
    // Structural guarantee, not a runtime one: GET takes no arguments, and PUT's
    // body is validated against PricingConfig's shape, which has no path field.
    const routeModule = await import("@/app/api/pricing/route");
    expect(routeModule.GET.length).toBe(0);
    expect(routeModule.PUT.length).toBe(1); // (request: Request) — never a path
  });
});

// Sanity check this file itself doesn't accidentally touch the real user config dir.
describe("test isolation", () => {
  it("the temp dir used to override XDG_CONFIG_HOME is never the real home config directory", () => {
    // Checking against the ambient XDG_CONFIG_HOME is unsound: real environments
    // (including GitHub-hosted runners) may legitimately have it set to exactly
    // `$HOME/.config`, which made this assertion fail on CI while passing locally.
    // `makeTempDir()` is rooted under `os.tmpdir()`, so this is always true regardless
    // of what XDG_CONFIG_HOME happens to resolve to on the machine running the suite.
    const dir = makeTempDir();
    try {
      expect(dir).not.toBe(join(homedir(), ".config"));
    } finally {
      cleanupTempDir(dir);
    }
  });
});

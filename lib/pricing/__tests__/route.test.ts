import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDir, makeTempDir } from "@/lib/db/__tests__/test-db";
import { resetPricingForTests } from "../config";

describe("GET/PUT /api/pricing", () => {
  let dir: string;
  let originalXdg: string | undefined;

  beforeEach(() => {
    dir = makeTempDir();
    originalXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = dir;
  });

  afterEach(() => {
    resetPricingForTests({ configHome: dir });
    if (originalXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdg;
    }
    cleanupTempDir(dir);
  });

  it("GET returns the default empty config plus pricableModels (no DB present here)", async () => {
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
  it("XDG_CONFIG_HOME override does not point at the real home directory", () => {
    expect(process.env.XDG_CONFIG_HOME).not.toBe(join(homedir(), ".config"));
  });
});

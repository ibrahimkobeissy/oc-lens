import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { browserCommand, openBrowser, parseArgs, readStartupMetadata, selectPort, serverSpawnOptions, startupLines } from "./cli-lib.js";

describe("OCL-130 CLI", () => {
  it("parses strict options and rejects invalid arguments", () => {
    expect(parseArgs(["--port", "4321", "--db=./fixture.db", "--no-open"])).toEqual({ port: 4321, dbPath: "./fixture.db", noOpen: true, help: false, version: false });
    expect(() => parseArgs(["--port", "0"])).toThrow(/1 to 65535/);
    expect(() => parseArgs(["--port", "3000.5"])).toThrow(/1 to 65535/);
    expect(() => parseArgs(["--db"])).toThrow(/requires a value/);
    expect(() => parseArgs(["--unknown"])).toThrow(/Unknown argument/);
  });

  it("increments only the default port and honours an explicit port exactly", async () => {
    const available = vi.fn(async (port: number) => port === 3002 || port === 4444);
    await expect(selectPort(null, available)).resolves.toBe(3002);
    await expect(selectPort(4444, available)).resolves.toBe(4444);
    await expect(selectPort(4445, available)).rejects.toThrow(/never auto-incremented/);
  });

  it("launches browser commands without a shell and can be completely suppressed by the caller", () => {
    expect(browserCommand("darwin", "http://127.0.0.1:3000")).toEqual({ command: "open", args: ["http://127.0.0.1:3000"] });
    expect(browserCommand("linux", "http://127.0.0.1:3000")).toEqual({ command: "xdg-open", args: ["http://127.0.0.1:3000"] });
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawn = vi.fn((command: string, args: readonly string[], options: object) => {
      void command; void args; void options;
      return child;
    });
    openBrowser("http://127.0.0.1:3000", { platform: "linux", spawn });
    expect(spawn).toHaveBeenCalledWith("xdg-open", ["http://127.0.0.1:3000"], expect.objectContaining({ stdio: "ignore" }));
    expect(spawn.mock.calls[0]?.[2]).not.toHaveProperty("shell");
  });

  it("builds a loopback-only child environment with an absolute authoritative DB override", () => {
    const result = serverSpawnOptions({ packageRoot: "/package", port: 4555, dbPath: "relative.db", env: { KEEP: "yes", HOSTNAME: "unsafe", NODE_ENV: "test" } });
    expect(result.serverPath).toBe(path.join("/package", ".next", "standalone", "server.js"));
    expect(result.options).toMatchObject({
      cwd: path.join("/package", ".next", "standalone"),
      env: { KEEP: "yes", HOSTNAME: "127.0.0.1", PORT: "4555", NODE_ENV: "production", OC_LENS_DB: path.resolve("relative.db") },
    });
  });

  it("reads valid startup metadata and reports missing DB metadata honestly", async () => {
    const populatedFetch = vi.fn(async (url: string) => url.endsWith("/api/settings")
      ? { ok: true, status: 200, json: async () => ({ data: { dbPath: "/fixture.db", schemaVersion: "opencode-1.17.7" } }) }
      : { ok: true, status: 200, json: async () => ({ data: { totalSessions: 120 } }) });
    await expect(readStartupMetadata("http://local", populatedFetch)).resolves.toEqual({ dbPath: "/fixture.db", schemaVersion: "opencode-1.17.7", sessionCount: 120 });

    const missingFetch = vi.fn(async (url: string) => url.endsWith("/api/settings")
      ? { ok: true, status: 200, json: async () => ({ data: { dbPath: null, schemaVersion: "opencode-1.17.7" } }) }
      : { ok: false, status: 404, json: async () => ({ error: { code: "database_not_found" } }) });
    const missing = await readStartupMetadata("http://local", missingFetch);
    expect(startupLines("http://local", missing)).toEqual([
      "[oc-lens] Ready: http://local",
      "[oc-lens] Database: not found",
      "[oc-lens] Schema: opencode-1.17.7",
      "[oc-lens] Sessions: unavailable",
    ]);
  });
});

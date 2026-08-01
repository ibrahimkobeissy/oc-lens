import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { locateDb } from "../locate";
import { cleanupTempDir, makeTempDir } from "./test-db";

describe("locateDb", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    cleanupTempDir(dir);
  });

  it("returns found:false with every searched path when nothing exists", () => {
    const ocLensDbPath = join(dir, "custom.db");
    const xdgPath = join(dir, "xdg", "opencode", "opencode.db");
    const defaultPath = join(dir, "home", ".local", "share", "opencode", "opencode.db");

    const result = locateDb({
      env: { OC_LENS_DB: ocLensDbPath, XDG_DATA_HOME: join(dir, "xdg") },
      homeDir: join(dir, "home"),
    });

    expect(result).toEqual({
      found: false,
      searched: [ocLensDbPath, xdgPath, defaultPath],
    });
  });

  it("honours OC_LENS_DB first, even when the other candidates also exist", () => {
    const ocLensDbPath = join(dir, "custom.db");
    writeFileSync(ocLensDbPath, "");
    const xdgDir = join(dir, "xdg", "opencode");
    mkdirSync(xdgDir, { recursive: true });
    writeFileSync(join(xdgDir, "opencode.db"), "");

    const result = locateDb({
      env: { OC_LENS_DB: ocLensDbPath, XDG_DATA_HOME: join(dir, "xdg") },
      homeDir: join(dir, "home"),
    });

    expect(result).toEqual({ found: true, path: ocLensDbPath });
  });

  it("falls back to $XDG_DATA_HOME/opencode/opencode.db when OC_LENS_DB is absent", () => {
    const xdgDir = join(dir, "xdg", "opencode");
    mkdirSync(xdgDir, { recursive: true });
    const dbPath = join(xdgDir, "opencode.db");
    writeFileSync(dbPath, "");

    const result = locateDb({
      env: { XDG_DATA_HOME: join(dir, "xdg") },
      homeDir: join(dir, "home"),
    });

    expect(result).toEqual({ found: true, path: dbPath });
  });

  it("falls back to ~/.local/share/opencode/opencode.db when nothing else is set", () => {
    const defaultDir = join(dir, "home", ".local", "share", "opencode");
    mkdirSync(defaultDir, { recursive: true });
    const dbPath = join(defaultDir, "opencode.db");
    writeFileSync(dbPath, "");

    const result = locateDb({ env: {}, homeDir: join(dir, "home") });

    expect(result).toEqual({ found: true, path: dbPath });
  });
});

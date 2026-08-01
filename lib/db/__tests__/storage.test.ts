import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeStorageSizes } from "../storage";
import { cleanupTempDir, makeTempDir } from "./test-db";

describe("computeStorageSizes", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    cleanupTempDir(dir);
  });

  it("sums opencode.db + -wal + log/ + repos/", () => {
    const dbPath = join(dir, "opencode.db");
    writeFileSync(dbPath, "a".repeat(100));
    writeFileSync(`${dbPath}-wal`, "b".repeat(20));
    mkdirSync(join(dir, "log"));
    writeFileSync(join(dir, "log", "out.log"), "c".repeat(30));
    mkdirSync(join(dir, "repos"));
    writeFileSync(join(dir, "repos", "r1"), "d".repeat(40));

    const sizes = computeStorageSizes(dbPath);

    expect(sizes.dbBytes).toBe(100);
    expect(sizes.walBytes).toBe(20);
    expect(sizes.logBytes).toBe(30);
    expect(sizes.reposBytes).toBe(40);
    expect(sizes.totalBytes).toBe(190);
  });

  it("reports null (not 0) for a missing log/ or repos/ directory", () => {
    const dbPath = join(dir, "opencode.db");
    writeFileSync(dbPath, "a".repeat(10));

    const sizes = computeStorageSizes(dbPath);

    expect(sizes.logBytes).toBeNull();
    expect(sizes.reposBytes).toBeNull();
    expect(sizes.totalBytes).toBe(10);
  });

  it("does not follow a symlink pointing outside the data directory", () => {
    const outsideDir = makeTempDir();
    try {
      const outsideFile = join(outsideDir, "big-secret-file");
      writeFileSync(outsideFile, "x".repeat(10_000));

      const dbPath = join(dir, "opencode.db");
      writeFileSync(dbPath, "a".repeat(10));
      mkdirSync(join(dir, "repos"));
      symlinkSync(outsideFile, join(dir, "repos", "escape-link"));

      const sizes = computeStorageSizes(dbPath);

      expect(sizes.reposBytes).toBe(0);
      expect(sizes.totalBytes).toBe(10);
    } finally {
      cleanupTempDir(outsideDir);
    }
  });
});

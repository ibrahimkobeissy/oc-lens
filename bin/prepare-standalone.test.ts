import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupTempDir, makeTempDir } from "@/lib/db/__tests__/test-db";
import { prepareStandalone } from "./prepare-standalone.js";

describe("prepareStandalone", () => {
  let root = "";
  afterEach(() => { if (root) cleanupTempDir(root); });

  it("copies static and public assets into the standalone root", () => {
    root = makeTempDir();
    mkdirSync(join(root, ".next", "standalone"), { recursive: true });
    mkdirSync(join(root, ".next", "static"), { recursive: true });
    mkdirSync(join(root, "public"), { recursive: true });
    writeFileSync(join(root, ".next", "static", "asset.js"), "static");
    writeFileSync(join(root, "public", "asset.txt"), "public");

    expect(prepareStandalone(root)).toBe(join(root, ".next", "standalone"));
    expect(readFileSync(join(root, ".next", "standalone", ".next", "static", "asset.js"), "utf8")).toBe("static");
    expect(readFileSync(join(root, ".next", "standalone", "public", "asset.txt"), "utf8")).toBe("public");
  });

  it("skips an absent public directory and rejects an absent standalone build", () => {
    root = makeTempDir();
    mkdirSync(join(root, ".next", "standalone"), { recursive: true });
    expect(() => prepareStandalone(root)).not.toThrow();
    expect(existsSync(join(root, ".next", "standalone", "public"))).toBe(false);
    cleanupTempDir(root);
    root = makeTempDir();
    expect(() => prepareStandalone(root)).toThrow(/standalone was not produced/);
  });
});

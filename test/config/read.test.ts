import * as fs from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDir, makeTempDir } from "@/lib/db/__tests__/test-db";
import { parseJsonc, readOpencodeConfig } from "@/lib/config/read";

vi.mock("node:fs", { spy: true });

describe("config reader", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanupTempDir(dir);
  });

  it("parses comments and trailing commas without changing comment-like strings", () => {
    expect(
      parseJsonc(`{
        // line comment
        "model": "openai/gpt-5", /* block comment */
        "plugin": ["https://example.invalid/a//b",],
      }`),
    ).toEqual({ model: "openai/gpt-5", plugin: ["https://example.invalid/a//b"] });
  });

  it("returns null when no config file exists", () => {
    expect(readOpencodeConfig({ configHome: dir, projectWorktrees: [] })).toBeNull();
  });

  it("layers project config over global config in deterministic worktree order", () => {
    const globalDir = join(dir, "config-home", "opencode");
    const projectA = join(dir, "a-project");
    const projectB = join(dir, "b-project");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.mkdirSync(projectA, { recursive: true });
    fs.mkdirSync(projectB, { recursive: true });
    fs.writeFileSync(join(globalDir, "opencode.jsonc"), '{"theme":"global","agent":{"build":{"mode":"primary"}}}');
    fs.writeFileSync(join(projectA, "opencode.jsonc"), '{"theme":"a","agent":{"review":{"mode":"subagent"}}}');
    fs.writeFileSync(join(projectB, "opencode.json"), '{"theme":"b","plugin":["project-plugin"]}');

    expect(
      readOpencodeConfig({
        configHome: join(dir, "config-home"),
        projectWorktrees: [projectB, projectA, projectA],
      }),
    ).toEqual({
      theme: "b",
      agent: { build: { mode: "primary" }, review: { mode: "subagent" } },
      plugin: ["project-plugin"],
    });
  });

  it("never opens auth.json or account.json", () => {
    const globalDir = join(dir, "opencode");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(join(globalDir, "opencode.jsonc"), '{"theme":"safe"}');
    fs.writeFileSync(join(globalDir, "auth.json"), '{"apiKey":"must-not-read"}');
    fs.writeFileSync(join(globalDir, "account.json"), '{"token":"must-not-read"}');
    vi.clearAllMocks();

    expect(readOpencodeConfig({ configHome: dir })).toEqual({ theme: "safe" });
    const opened = vi.mocked(fs.readFileSync).mock.calls.map(([path]) => String(path));
    expect(opened).toEqual([join(globalDir, "opencode.jsonc")]);
    expect(opened.some((path) => path.endsWith("auth.json") || path.endsWith("account.json"))).toBe(false);
  });
});

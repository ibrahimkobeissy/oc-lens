import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getOpencodeHealth, MAX_OPENCODE_TIMEOUT_MS } from "./opencode-client";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.[cm]?[jt]sx?$/.test(name) ? [path] : [];
  });
}

describe("OCL-112 opencode live client", () => {
  it("is opt-in and makes no request without a configured URL", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const health = await getOpencodeHealth({ baseUrl: "", fetch: fetchMock });
    expect(health.state).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("degrades to not-running and bounds the configured timeout", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("connection refused"));
    const health = await getOpencodeHealth({ baseUrl: "http://127.0.0.1:4096", timeoutMs: 99_999, fetch: fetchMock });
    expect(health.state).toBe("not-running");
    expect(health.timeoutMs).toBe(MAX_OPENCODE_TIMEOUT_MS);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("renders safe MCP/LSP statuses without parsing agent or config bodies", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      if (path === "/mcp") return response({ docs: { status: "connected", secret: "ignored" } });
      if (path === "/lsp") return response([{ name: "typescript", status: "running", token: "ignored" }]);
      return new Response("do-not-parse", { status: 200 });
    });
    const health = await getOpencodeHealth({ baseUrl: "http://localhost:4096", fetch: fetchMock });
    expect(health.state).toBe("running");
    expect(health.mcp.items).toEqual([{ name: "docs", status: "connected" }]);
    expect(health.lsp.items).toEqual([{ name: "typescript", status: "running" }]);
    expect(health.agent.itemCount).toBeNull();
    expect(health.config.itemCount).toBeNull();
    expect(JSON.stringify(health)).not.toContain("ignored");
  });

  it("is imported by no route or page except its own health route", () => {
    const offenders = sourceFiles("app").filter((path) => path !== join("app", "api", "health", "route.ts") && readFileSync(path, "utf8").includes("@/lib/http/opencode-client"));
    expect(offenders).toEqual([]);
  });
});

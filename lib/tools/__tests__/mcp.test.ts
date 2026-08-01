import { describe, expect, it } from "vitest";
import { resolveMcpTool } from "../mcp";

/** What a caller doing a naive first-underscore split would get — for comparison only. */
function naiveSplit(name: string): { server: string; tool: string } {
  const idx = name.indexOf("_");
  if (idx === -1) return { server: name, tool: "" };
  return { server: name.slice(0, idx), tool: name.slice(idx + 1) };
}

describe("resolveMcpTool", () => {
  it("resolves an underscore-containing server name via longest-prefix match", () => {
    const servers = ["my_mcp", "search"];
    expect(resolveMcpTool("my_mcp_search_query", servers)).toEqual({
      server: "my_mcp",
      tool: "search_query",
    });
  });

  it("beats a naive first-underscore split on the same ambiguous input", () => {
    const servers = ["my_mcp", "search"];
    const name = "my_mcp_search_query";

    const naive = naiveSplit(name);
    expect(naive).toEqual({ server: "my", tool: "mcp_search_query" }); // wrong: "my" isn't a configured server

    const correct = resolveMcpTool(name, servers);
    expect(correct).toEqual({ server: "my_mcp", tool: "search_query" });
    expect(correct).not.toEqual(naive);
  });

  it("picks the longest matching server when multiple configured names are prefixes", () => {
    const servers = ["git", "git_advanced"];
    expect(resolveMcpTool("git_advanced_commit", servers)).toEqual({
      server: "git_advanced",
      tool: "commit",
    });
  });

  it("returns null for a tool that matches no configured server, rather than guessing", () => {
    expect(resolveMcpTool("foo_bar", ["baz"])).toBeNull();
  });

  it("returns null when the tool name equals a server name with no trailing tool segment", () => {
    expect(resolveMcpTool("search", ["search"])).toBeNull();
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { inferredMcpServers, McpServerPanel } from "@/components/tools/mcp-server-panel";
import type { McpServerSummary, ToolSummary } from "@/types/oc";

const server: McpServerSummary = { server: "linear_docs", toolCalls: 4, errorCount: 1, tools: [{ tool: "search_query", calls: 4 }] };
function tool(name: string, calls: number, errors = 0): ToolSummary { return { tool: name, category: "other", totalCalls: calls, completedCount: calls - errors, errorCount: errors, pendingCount: 0, runningCount: 0, p50DurationMs: null, p95DurationMs: null, firstSeen: 1, lastSeen: 1 }; }

describe("OCL-073 MCP panel", () => {
  it("keeps an underscore-containing configured server grouped by its resolved name", () => {
    const html = renderToStaticMarkup(<McpServerPanel servers={[server]} tools={[tool("linear_docs_search_query", 4)]} />);
    expect(html).toContain("linear_docs");
    expect(html).toContain("search_query");
    expect(html).toContain("25.0%");
    expect(html).not.toContain(">inferred from tool names</");
  });

  it("shows MCP tools no configured server claims, grouped by name prefix and labelled inferred", () => {
    const tools = [tool("tracker_issue_get", 25), tool("tracker_issue_comment", 24, 1), tool("serena_find_symbol", 16), tool("read", 90), tool("linear_docs_search_query", 4)];
    expect(inferredMcpServers([server], tools)).toEqual([
      { server: "tracker", toolCalls: 49, errorCount: 1, tools: [{ tool: "issue_get", calls: 25 }, { tool: "issue_comment", calls: 24 }] },
      { server: "serena", toolCalls: 16, errorCount: 0, tools: [{ tool: "find_symbol", calls: 16 }] },
    ]);
    const html = renderToStaticMarkup(<McpServerPanel servers={[]} tools={tools} />);
    expect(html).toContain("tracker");
    expect(html).toContain(">inferred from tool names</");
    expect(html).not.toContain("No MCP server activity");
  });

  it("renders the honest empty state with no MCP activity at all", () => {
    expect(renderToStaticMarkup(<McpServerPanel servers={[]} tools={[tool("read", 3)]} />)).toContain("No MCP server activity");
  });
});

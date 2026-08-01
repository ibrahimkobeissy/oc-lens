import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { McpServerPanel, unresolvedMcpTools } from "@/components/tools/mcp-server-panel";
import type { McpServerSummary, ToolSummary } from "@/types/oc";

const server: McpServerSummary = { server: "linear_docs", toolCalls: 4, errorCount: 1, tools: [{ tool: "search_query", calls: 4 }] };
function tool(name: string, calls: number): ToolSummary { return { tool: name, category: "other", totalCalls: calls, completedCount: calls, errorCount: 0, pendingCount: 0, runningCount: 0, p50DurationMs: null, p95DurationMs: null, firstSeen: 1, lastSeen: 1 }; }

describe("OCL-073 MCP panel", () => {
  it("keeps an underscore-containing server grouped by the resolved server name", () => {
    const html = renderToStaticMarkup(<McpServerPanel servers={[server]} tools={[tool("linear_docs_search_query", 4)]} />);
    expect(html).toContain("linear_docs");
    expect(html).toContain("search_query");
    expect(html).toContain("25.0%");
    expect(html).not.toContain("Unresolved MCP-shaped tools");
  });

  it("places unmatched underscore names in the explicit unresolved bucket", () => {
    const mystery = tool("future_server_unknown_call", 3);
    expect(unresolvedMcpTools([server], [mystery])).toEqual([mystery]);
    const html = renderToStaticMarkup(<McpServerPanel servers={[server]} tools={[mystery]} />);
    expect(html).toContain("Unresolved MCP-shaped tools");
    expect(html).toContain("leaves them unresolved instead of guessing");
  });

  it("renders the honest empty state with no resolved or shaped activity", () => {
    const html = renderToStaticMarkup(<McpServerPanel servers={[]} tools={[]} />);
    expect(html).toContain("No MCP server activity");
  });
});

export interface ResolvedMcpTool {
  server: string;
  tool: string;
}

/**
 * MCP tools appear as `<server>_<tool>` (data-model.md §5), and both server
 * and tool names can themselves contain underscores — a naive first-underscore
 * split is ambiguous and can pick the wrong server. This matches by the
 * LONGEST configured server name that is a valid `_`-delimited prefix of
 * `name`, never guessing when no configured server matches.
 */
export function resolveMcpTool(name: string, servers: string[]): ResolvedMcpTool | null {
  const matches = servers.filter((server) => name.startsWith(`${server}_`)).sort((a, b) => b.length - a.length);

  const server = matches[0];
  if (server === undefined) return null;

  return { server, tool: name.slice(server.length + 1) };
}

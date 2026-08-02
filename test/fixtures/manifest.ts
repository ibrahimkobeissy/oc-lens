/**
 * What the fixture guarantees. Import these constants in downstream tests
 * instead of re-deriving magic numbers/strings from the generator — this is
 * the contract, not an implementation detail.
 */

export const FIXTURE_SEED = 424242;

export const MINIMUMS = {
  projects: 6,
  sessions: 120,
  subagentSessions: 8,
  archivedSessions: 5,
  nullAgentSessions: 10,
  nullModelSessions: 10,
  placeholderTitleSessions: 4,
  singleMessageSessions: 3,
  messages: 4000,
  parts: 12000,
  errorToolCalls: 40,
  skillNames: 5,
  compactionParts: 1,
  patchParts: 1,
} as const;

/** The one session generated with exactly 400 messages. */
export const LONG_SESSION_MESSAGE_COUNT = 400;

export const CORE_TOOLS = [
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "glob",
  "webfetch",
  "todowrite",
  "task",
  "skill",
  "question",
] as const;

/**
 * MCP-shaped tool names (`<server>_<tool>`). `linear_docs` is the server
 * whose own name contains an underscore — naively splitting on the *first*
 * underscore would misread it as server `linear`, tool `docs_search`, which
 * is wrong; the real server is `linear_docs`, tool `search`.
 */
export const MCP_SERVERS = {
  serena: { server: "serena", tools: ["find_symbol", "get_symbols_overview"] },
  linear_docs: { server: "linear_docs", tools: ["search"] },
} as const;

export const MCP_TOOL_NAMES = ["serena_find_symbol", "serena_get_symbols_overview", "linear_docs_search"] as const;

export const SKILL_NAMES = ["code-review", "test-runner", "deploy-helper", "changelog-writer", "docs-sync"] as const;

export const PROVIDER_MODELS = [
  { providerID: "opencode", modelID: "deepseek-v4-flash-free" },
  { providerID: "opencode", modelID: "qwen3-coder" },
  { providerID: "anthropic", modelID: "claude-sonnet-5" },
  { providerID: "anthropic", modelID: "claude-haiku-4-5" },
  { providerID: "openai", modelID: "gpt-5-mini" },
  { providerID: "google", modelID: "gemini-2.5-pro" },
] as const;

export const AGENTS = ["build", "plan"] as const;

/** The synthetic global project — data-model.md §3. */
export const GLOBAL_PROJECT_ID = "global";

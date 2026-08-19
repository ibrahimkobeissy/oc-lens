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
  loopSessions: 6,
} as const;

/**
 * Planted loop scenarios — ground truth for loop detection.
 *
 * The randomly generated sessions cannot test loop detection: their tool
 * inputs are unique by construction (file paths carry a part counter), so
 * nothing ever repeats. These six sessions are scripted instead and appended
 * after the random population, generated with no rng draws at all so that
 * sessions ses_0000–ses_0119 stay byte-identical. They are dated past the
 * random span so date-range filters over the populated period skip them.
 *
 * `expectedIncidents` is the contract: a detector run over one of these
 * sessions must find exactly that many incidents — no more, no fewer. Two
 * scenarios expect **zero**, and they are the important ones: `unsignaturable`
 * (identical-looking calls that carry no recorded input, so repetition cannot
 * honestly be claimed) and `control` (real iterative work that a naive
 * same-tool or same-file rule would wrongly flag).
 *
 * Signature counts are deliberately split, because conflating them is itself a
 * bug this fixture caught: `incidentSignatures` is how many distinct signatures
 * *compose the incident*, `sessionSignatures` how many distinct signaturable
 * signatures exist in the session at all. `oscillation` is the case that forces
 * the distinction — A→B→A→B is **one** oscillation incident built from **two**
 * signatures, not two separate redundant-repeat incidents. A detector that
 * counts "any signature seen more than once" reports 2 there and is wrong.
 *
 * **Assert per session, never globally.** The fixture has a known noise floor:
 * `skill` calls cycle through SKILL_NAMES, so the 400-message session re-invokes
 * each skill 4× (7 incidental repeats across 2 unplanted sessions). That is
 * realistic agent behaviour and is left in deliberately.
 */
export const LOOP_SCENARIOS = {
  /** 4× the same failing edit — the "looping on errors" case. */
  errorRetry: {
    sessionId: "ses_0120",
    tool: "edit",
    incidentCalls: 4,
    sessionCalls: 4,
    status: "error",
    incidentSignatures: 1,
    sessionSignatures: 1,
    expectedIncidents: 1,
  },
  /** 5× the same successful read — burning tokens for no new information. */
  redundantRepeat: {
    sessionId: "ses_0121",
    tool: "read",
    incidentCalls: 5,
    sessionCalls: 5,
    status: "completed",
    incidentSignatures: 1,
    sessionSignatures: 1,
    expectedIncidents: 1,
  },
  /** A→B→A→B content flip on one path — undoing its own work. */
  oscillation: {
    sessionId: "ses_0122",
    tool: "write",
    incidentCalls: 4,
    sessionCalls: 4,
    status: "completed",
    incidentSignatures: 2,
    sessionSignatures: 2,
    expectedIncidents: 1,
  },
  /**
   * 4 identical-looking glob calls that record no input — must NOT be flagged.
   * Two carry `input: {}` and two omit the `input` key entirely, because both
   * shapes occur and both must be treated as unsignaturable rather than equal.
   */
  unsignaturable: {
    sessionId: "ses_0123",
    tool: "glob",
    incidentCalls: 0,
    sessionCalls: 4,
    status: "completed",
    incidentSignatures: 0,
    sessionSignatures: 0,
    expectedIncidents: 0,
  },
  /** The same bash command 3×, separated by other calls — repetition is not always adjacent. */
  interleavedRepeat: {
    sessionId: "ses_0124",
    tool: "bash",
    incidentCalls: 3,
    sessionCalls: 5,
    status: "completed",
    incidentSignatures: 1,
    sessionSignatures: 2,
    expectedIncidents: 1,
  },
  /**
   * False-positive guard: 5 reads of *different* files plus 3 edits to one
   * file with *different* content each time. That is ordinary iterative work.
   * A naive same-tool or same-file rule flags it; a signature rule must not.
   */
  control: {
    sessionId: "ses_0125",
    tool: "read+edit",
    incidentCalls: 0,
    sessionCalls: 8,
    status: "completed",
    incidentSignatures: 0,
    sessionSignatures: 8,
    expectedIncidents: 0,
  },
} as const;

/**
 * Fixed token usage on every planted loop turn. Deterministic on purpose: the
 * wasted-cost figure a detector reports is then exactly
 * `calls × price(LOOP_TURN_USAGE)`, so cost assertions need no tolerance.
 */
export const LOOP_TURN_USAGE = {
  input: 1000,
  output: 100,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
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

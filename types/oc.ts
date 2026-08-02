/**
 * oc-lens domain types and API contracts — OCL-010, KEYSTONE.
 *
 * FROZEN on merge. Every field below carries a one-line JSDoc naming its
 * opencode source column or JSON path (or `// derived` when computed, not
 * stored). Source-of-truth for shapes is `project-docs/opencode-data-model.md`
 * — do not infer a shape from memory or from `.reference/cc-lens`.
 *
 * Route table
 * -----------
 * This lists exactly the routes named in backlog.md §4.1's dependency graph
 * ("API routes: 030 040 050 052 060 070 080 091 110 120"). Every route wraps
 * its payload in `OcEnvelope<T>` (success) or returns `OcErrorEnvelope`
 * (failure) — see "Envelope" below. Routes owned by later tickets (pricing
 * OCL-016, search OCL-022, storage OCL-035, agents OCL-101, skills OCL-102,
 * health OCL-112, subagent tree OCL-100, file timeline OCL-103) are not in
 * §4.1's list and add their own response types to this file via a documented
 * amendment when their ticket lands, per backlog.md §4.3's serialisation note.
 *
 * | Ticket  | Route                          | Response type (wrapped in OcResponse<T>) |
 * |---------|---------------------------------|-------------------------------------------|
 * | OCL-030 | GET /api/stats                  | OverviewStats                             |
 * | OCL-040 | GET /api/activity                | ActivityStats                             |
 * | OCL-050 | GET /api/sessions                | SessionListResponse                       |
 * | OCL-050 | GET /api/sessions/[id]           | SessionDetail                             |
 * | OCL-052 | GET /api/sessions/[id]/replay     | SessionReplay                             |
 * | OCL-060 | GET /api/projects                | ProjectSummary[]                          |
 * | OCL-060 | GET /api/projects/[id]            | ProjectDetail                             |
 * | OCL-070 | GET /api/tools                   | ToolsStats                                |
 * | OCL-080 | GET /api/todos                   | TodosResponse                             |
 * | OCL-091 | GET /api/costs                   | CostBreakdown                             |
 * | OCL-110 | GET /api/settings                | SettingsResponse                          |
 * | OCL-120 | GET /api/export                  | ExportResponse                            |
 */

// ─── Envelope ──────────────────────────────────────────────────────────────

/** One caveat about the data ("34 rows had a null agent") that must reach the user, never silently swallowed into a wrong number. */
export interface OcWarning {
  code: string; // derived: a stable machine-readable code, e.g. "unknown-agent"
  message: string; // derived: human-readable explanation
  count: number; // derived: how many rows this warning covers
}

export interface OcMeta {
  generatedAt: number; // derived: epoch ms, server clock at response time
  schemaVersion: string; // derived: lib/db/schema-guard.ts's pinned schemaVersion constant, e.g. "opencode-1.17.7"
  warnings: OcWarning[];
}

export interface OcEnvelope<T> {
  data: T;
  meta: OcMeta;
}

export interface OcErrorBody {
  code: string; // derived: e.g. "not_found", "schema_mismatch", "invalid_body"
  message: string; // derived: human-readable explanation
}

export interface OcErrorEnvelope {
  error: OcErrorBody;
}

/** Every API route returns this: `OcEnvelope<T>` on success, `OcErrorEnvelope` on failure. */
export type OcResponse<T> = OcEnvelope<T> | OcErrorEnvelope;

// ─── Money and tokens ───────────────────────────────────────────────────────

/**
 * `priced: false` means "the user has not entered a price for this model" —
 * the UI renders "not priced", never `$0.00` (D3). No code path may return
 * `priced: true` with a zero rate.
 */
export interface OcCost {
  amount: number; // derived: lib/pricing costFor(usage, key) — 0 whenever priced is false
  priced: boolean; // derived: true iff the user has entered a price for this providerID/modelID
}

export interface OcTokens {
  input: number; // message.data.tokens.input / session.tokens_input
  output: number; // message.data.tokens.output / session.tokens_output
  reasoning: number; // message.data.tokens.reasoning / session.tokens_reasoning
  cacheRead: number; // message.data.tokens.cache.read / session.tokens_cache_read
  cacheWrite: number; // message.data.tokens.cache.write / session.tokens_cache_write
}

// ─── Enums / unions ─────────────────────────────────────────────────────────

/**
 * `file`, `agent`, `snapshot` are still ⚠️ UNVERIFIED (data-model §5) and are
 * not part of this union — a future ticket adds its verified variant via a
 * documented amendment after its own probe. Until then those shapes decode
 * to `'unknown'`. `compaction` and `patch` were both confirmed live against
 * a real opencode.db on 2026-08-02 (data-model §5) and are added here.
 */
export type PartType = "text" | "reasoning" | "step-start" | "step-finish" | "tool" | "compaction" | "patch" | "unknown";

export type ToolStatus = "completed" | "error" | "pending" | "running" | "unknown";

/** Any `message.data.role` outside `user`/`assistant` decodes to `'unknown'` rather than throwing (data-model §4). */
export type MessageRole = "user" | "assistant" | "unknown";

/**
 * opencode's agent name (`session.agent`, `message.data.agent`) — an open
 * string, not a closed union, since agent names are user-configurable. A
 * null/missing value is bucketed to the literal `'unknown'` sentinel by the
 * query layer, never dropped and never defaulted to `'build'`.
 */
export type AgentName = string;

export type ToolCategory = "file" | "search" | "exec" | "web" | "planning" | "delegation" | "other";

export type TodoStatus = "pending" | "in_progress" | "completed" | "unknown";

// ─── Entities ────────────────────────────────────────────────────────────────

export interface OcProject {
  id: string; // project.id
  displayName: string; // derived: project.name → basename(project.worktree) → the literal 'global' for id === 'global' (data-model §3)
  worktree: string; // project.worktree
  vcs: string | null; // project.vcs
  timeCreated: number; // project.time_created
  timeUpdated: number; // project.time_updated
  timeInitialized: number | null; // project.time_initialized
}

/** A decoded `session.model` blob, or `null` for a NULL column (data-model §2). */
export interface OcSessionModel {
  id: string; // session.model (JSON).id
  providerID: string; // session.model (JSON).providerID
  variant: string; // session.model (JSON).variant
}

export interface OcSession {
  id: string; // session.id
  projectId: string; // session.project_id
  parentId: string | null; // session.parent_id — the subagent link, NULL for a root session
  slug: string; // session.slug
  directory: string; // session.directory
  title: string; // session.title, with the placeholder-title pattern (`New session - <ISO>`) detected and left for the query layer to substitute
  version: string; // session.version
  agent: string | null; // session.agent
  model: OcSessionModel | null; // derived: decodeSessionModel(session.model) — prefer message.data.modelID/providerID for per-model analytics
  timeCreated: number; // session.time_created
  timeUpdated: number; // session.time_updated
  timeArchived: number | null; // session.time_archived — non-null means archived
  tokens: OcTokens; // session.tokens_input / tokens_output / tokens_reasoning / tokens_cache_read / tokens_cache_write
  storedCost: number; // session.cost — provider-reported comparison value only (D3); never oc-lens's own cost figure
}

export interface OcMessageData {
  role: MessageRole; // message.data.role
  agent: string | null; // message.data.agent
  mode: string | null; // message.data.mode — the run mode; not guaranteed equal to `agent` (data-model §4)
  modelID: string | null; // message.data.modelID
  providerID: string | null; // message.data.providerID
  tokens: OcTokens | null; // message.data.tokens.{input,output,reasoning,cache.{read,write}} — null on messages that carry no usage (e.g. user messages)
  cost: number | null; // message.data.cost — provider-reported, not oc-lens's cost model
  timeCreated: number | null; // message.data.time.created
  timeCompleted: number | null; // message.data.time.completed — absent on user messages and in-flight assistant messages; null, never 0
  parentId: string | null; // message.data.parentID — links a subagent message back to its parent turn
  finish: string | null; // message.data.finish
}

export interface OcMessage {
  id: string; // message.id
  sessionId: string; // message.session_id
  timeCreated: number; // message.time_created
  timeUpdated: number; // message.time_updated
  data: OcMessageData;
}

export interface OcPartTextData {
  type: "text";
  text: string; // part.data.text
}

export interface OcPartReasoningData {
  type: "reasoning";
  text: string; // part.data.text
  timeStart: number | null; // part.data.time.start
  timeEnd: number | null; // part.data.time.end
}

export interface OcPartStepStartData {
  type: "step-start";
}

export interface OcPartStepFinishData {
  type: "step-finish";
  reason: string | null; // part.data.reason
  cost: number | null; // part.data.cost — provider-reported, the finest-grained cost signal available
  tokens: OcTokens | null; // part.data.tokens.{input,output,reasoning,cache.{read,write}}
}

export interface OcPartToolData {
  type: "tool";
  tool: string; // part.data.tool — opencode's lowercase tool name (read, write, edit, bash, …)
  callId: string; // part.data.callID
  status: ToolStatus; // part.data.state.status
  /** Tool-specific args — shape varies per tool, kept opaque by design. Narrow before use. */
  input: unknown; // part.data.state.input
  output: string | null; // part.data.state.output
  title: string | null; // part.data.state.title
  timeStart: number | null; // part.data.state.time.start
  timeEnd: number | null; // part.data.state.time.end
}

/** Context compaction — confirmed live 2026-08-02 (data-model §5). Only the three fields actually observed; opencode has no pre-compaction token count. */
export interface OcPartCompactionData {
  type: "compaction";
  auto: boolean; // part.data.auto — triggered automatically vs. user-invoked
  overflow: boolean; // part.data.overflow — triggered because the context window overflowed
  tailStartId: string; // part.data.tail_start_id — message.id of the first message retained after the compacted head
}

/**
 * A workspace-wide diff snapshot — confirmed live 2026-08-02 (data-model §5). **Not**
 * scoped to the owning session or message: the same `hash`/`files` pair has been
 * observed attached to messages in two different sessions, including a file a
 * *subagent* wrote that the owning message's own tool calls never touched. Treat
 * this as "the working tree had these files diffed at this point in time," never as
 * "this session/turn changed these files" — OCL-103's file-change timeline
 * deliberately does not use this as evidence for that reason (see the data-model doc).
 */
export interface OcPartPatchData {
  type: "patch";
  hash: string; // part.data.hash
  files: string[]; // part.data.files
}

/** A part type not in the verified set — never thrown away, always rendered as a labelled placeholder. */
export interface OcPartUnknownData {
  type: "unknown";
  rawType: string; // the unrecognised part.data.type value
  raw: unknown; // part.data verbatim
}

export type OcPartData =
  | OcPartTextData
  | OcPartReasoningData
  | OcPartStepStartData
  | OcPartStepFinishData
  | OcPartToolData
  | OcPartCompactionData
  | OcPartPatchData
  | OcPartUnknownData;

export interface OcPart {
  id: string; // part.id
  messageId: string; // part.message_id
  sessionId: string; // part.session_id
  timeCreated: number; // part.time_created
  timeUpdated: number; // part.time_updated
  data: OcPartData;
}

export interface OcTodo {
  sessionId: string; // todo.session_id
  content: string; // todo.content
  status: TodoStatus; // todo.status — an unrecognised value decodes to 'unknown', never silently dropped
  priority: string | null; // todo.priority
  position: number; // todo.position
  timeCreated: number; // todo.time_created
  timeUpdated: number; // todo.time_updated
}

/**
 * A flattened, query-friendly view of a `tool` part — what `lib/queries`
 * aggregates (`ToolSummary`, `ToolErrorSummary`, …) are built from, as
 * distinct from the raw discriminated `OcPartToolData` the replay stream uses.
 */
export interface OcToolCall {
  id: string; // part.id
  sessionId: string; // part.session_id
  messageId: string; // part.message_id
  tool: string; // part.data.tool
  category: ToolCategory; // derived: lib/tools categorizeTool(tool)
  callId: string; // part.data.callID
  status: ToolStatus; // part.data.state.status
  durationMs: number | null; // derived: state.time.end - state.time.start; null (not 0) when either is absent
  timeStart: number | null; // part.data.state.time.start
  timeEnd: number | null; // part.data.state.time.end
  errorMessage: string | null; // part.data.state.output / state.error, present when status === 'error'
}

// ─── Aggregates ──────────────────────────────────────────────────────────────

export interface DailyActivity {
  date: string; // derived: local calendar day (YYYY-MM-DD) of time_created, bucketed in the request's IANA timezone
  sessionCount: number;
  messageCount: number;
  toolCallCount: number;
}

export interface HourBucket {
  hour: number; // derived: local hour (0-23) of time_created in the request's IANA timezone
  count: number;
}

export interface DayOfWeekBucket {
  day: number; // derived: local day of week (0 Sunday – 6 Saturday) of time_created
  count: number;
}

export interface StreakSummary {
  currentStreakDays: number; // derived: consecutive active days ending today, in the request's timezone
  longestStreakDays: number; // derived
  longestStreakStart: string | null; // derived: YYYY-MM-DD
  longestStreakEnd: string | null; // derived: YYYY-MM-DD
  mostActiveDay: string | null; // derived: YYYY-MM-DD with the highest activity count
  totalActiveDays: number; // derived
  firstSessionDate: string | null; // derived: YYYY-MM-DD of the earliest session.time_created
}

export interface ModelUsage {
  providerID: string; // message.data.providerID — the literal 'unknown' sentinel buckets null/missing values
  modelID: string; // message.data.modelID — the literal 'unknown' sentinel buckets null/missing values
  sessionCount: number;
  messageCount: number;
  tokens: OcTokens;
  cost: OcCost;
}

export interface ProjectSummary {
  id: string; // project.id
  displayName: string; // derived: fallback chain, data-model §3
  worktree: string; // project.worktree
  sessionCount: number;
  messageCount: number;
  tokens: OcTokens;
  cost: OcCost;
  firstActivity: number | null; // derived: earliest session.time_created for this project
  lastActivity: number | null; // derived: latest session.time_updated for this project
}

export interface SessionSummary {
  id: string; // session.id
  slug: string; // session.slug
  title: string; // derived: session.title, placeholder pattern replaced by the first user text part, or the slug if there is none
  projectId: string; // session.project_id
  projectDisplayName: string; // derived: OcProject.displayName for projectId
  directory: string; // session.directory
  agent: string | null; // session.agent — raw value; 'unknown' bucketing happens in aggregates that group by agent
  model: OcSessionModel | null; // derived: decodeSessionModel(session.model)
  version: string; // session.version
  timeCreated: number; // session.time_created
  timeUpdated: number; // session.time_updated
  durationMs: number | null; // derived: time_updated - time_created
  timeArchived: number | null; // session.time_archived
  parentId: string | null; // session.parent_id
  messageCounts: { user: number; assistant: number }; // derived: count of message rows by data.role for this session
  toolCallCount: number; // derived: count of part rows with data.type === 'tool' for this session
  errorCount: number; // derived: count of tool parts whose data.state.status === 'error' (OCL-051 contract amendment)
  tokens: OcTokens; // session.tokens_*
  cost: OcCost;
  hasReasoning: boolean; // derived: any part with data.type === 'reasoning'
  hasCompaction: boolean; // derived: any part with data.type === 'compaction' (⚠️ UNVERIFIED, data-model §5 — false until OCL-055's probe lands)
  usesMcp: boolean; // derived: any tool part resolving to a configured MCP server
  usesSubagent: boolean; // derived: any part.data.tool === 'task', or a child session with parent_id === this id
  usesWebfetch: boolean; // derived: any part.data.tool === 'webfetch'
}

export interface ToolSummary {
  tool: string; // part.data.tool
  category: ToolCategory; // derived: lib/tools categorizeTool(tool)
  totalCalls: number;
  completedCount: number; // derived: count where state.status === 'completed'
  errorCount: number; // derived: count where state.status === 'error'
  pendingCount: number; // derived: count where state.status === 'pending'
  runningCount: number; // derived: count where state.status === 'running'
  p50DurationMs: number | null; // derived: median of state.time.end - state.time.start; null when no call has both timestamps
  p95DurationMs: number | null; // derived: same, 95th percentile
  firstSeen: number | null; // derived: earliest part.time_created for this tool
  lastSeen: number | null; // derived: latest part.time_created for this tool
}

export interface ToolActivityPoint {
  date: string; // derived: local calendar day of part.time_created
  totalCalls: number;
  errorCount: number;
}

export interface McpServerSummary {
  server: string; // derived: lib/tools resolveMcpTool longest-prefix match against configured server names
  toolCalls: number;
  errorCount: number;
  tools: Array<{ tool: string; calls: number }>; // derived: per-tool breakdown within this server
}

export interface ToolErrorSummary {
  partId: string; // part.id
  sessionId: string; // part.session_id
  tool: string; // part.data.tool
  message: string; // part.data.state.output / state.error
  category: string; // derived: lib/tools categorizeToolError(message) — 'other' is the honest fallback
  timeCreated: number; // part.time_created
}

export interface AgentSummary {
  agent: string; // session.agent / message.data.agent — the literal 'unknown' row for null values, never merged into a named agent
  sessionCount: number;
  messageCount: number;
  tokens: OcTokens;
  cost: OcCost;
  toolMix: Array<{ tool: string; calls: number }>; // derived
  errorCount: number; // derived: tool calls with state.status === 'error' across this agent's sessions
  avgSessionLengthMs: number | null; // derived
}

export interface AgentActivityPoint {
  date: string; // derived: UTC YYYY-MM-DD from message.time_created
  agent: string; // message.data.agent, with missing values bucketed as the literal 'unknown'
  messageCount: number; // derived
}

export interface AgentSwitchEvent {
  seq: number; // session_message.seq where type = 'agent-switched'
  sessionId: string | null; // session_message.data.sessionId
  agent: string; // session_message.data.to, with malformed/missing values as the literal 'unknown'
  timeCreated: number | null; // session_message.data.time, null when malformed/missing
}

export interface AgentsResponse {
  agents: AgentSummary[]; // derived: lib/queries/agents.ts agentUsage
  activity: AgentActivityPoint[]; // derived: lib/queries/agents.ts agentActivity
  switches: AgentSwitchEvent[]; // derived: lib/queries/agents.ts agentSwitchEvents
}

export interface SkillSummary {
  skill: string; // derived: extracted from the 'skill' tool's state.input — the literal 'unknown' bucket when no recognisable name is present
  totalCalls: number;
  sessionCount: number;
  errorCount: number;
  p50DurationMs: number | null; // derived from state.time.start/end; null when no invocation has both timestamps
  p95DurationMs: number | null;
}

export interface FileChangeSummary {
  sessionId: string; // part.session_id
  filePath: string; // part.data.state.input.filePath / state.metadata.filepath — ✅ verified source; the `patch` part type itself is ⚠️ UNVERIFIED (data-model §5), see OCL-103
  tool: string; // part.data.tool
  timeCreated: number; // part.time_created
  partId: string; // part.id
}

/** GET /api/sessions/[id]/files payload (OCL-103 verified tool-call fallback). */
export interface SessionFilesData {
  changes: FileChangeSummary[];
  projectWorktree: string | null; // project.worktree, used only to render relative paths with the absolute path retained as evidence
}

export interface CostBreakdown {
  totalCost: OcCost;
  storedCostComparison: number; // derived: sum of session.cost / message.data.cost — provider-reported, labelled separately per D3
  byModel: Array<{ providerID: string; modelID: string; tokens: OcTokens; cost: OcCost }>;
  byProject: Array<{ projectId: string; cost: OcCost }>;
  byDay: Array<{ date: string; cost: OcCost }>; // date is YYYY-MM-DD in the request's timezone
  bySession: Array<{ sessionId: string; cost: OcCost }>;
  byAgent: Array<{ agent: string; cost: OcCost }>; // 'unknown' bucket for null agent
}

export interface PricingModelRate {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
  currency: "USD";
}

export interface PricingConfig {
  version: 1;
  prices: Record<string, PricingModelRate>; // key: `${providerID}/${modelID}` — user-entered, from ~/.config/oc-lens/config.json
  updatedAt: number; // derived: epoch ms of the last successful write
}

/** One provider/model observed in assistant messages, with its aggregate token evidence. */
export interface PricableModel {
  providerID: string;
  modelID: string;
  key: string; // derived: `${providerID}/${modelID}`
  tokens: OcTokens;
  priced: boolean; // derived: key exists in PricingConfig.prices
}

/** GET /api/pricing payload (OCL-090 additive route contract). */
export interface PricingSettingsResponse extends PricingConfig {
  pricableModels: PricableModel[];
}

// ─── Replay ──────────────────────────────────────────────────────────────────

export interface ReplayPart {
  id: string; // part.id
  data: OcPartData;
}

export interface ReplayTurn {
  messageId: string; // message.id
  role: MessageRole; // message.data.role
  agent: string | null; // message.data.agent
  timeCreated: number; // message.data.time.created
  timeCompleted: number | null; // message.data.time.completed — null (not 0) when absent
  durationMs: number | null; // derived: timeCompleted - timeCreated, null when timeCompleted is null
  tokens: OcTokens | null; // message.data.tokens.*
  cost: OcCost;
  parts: ReplayPart[]; // ordered by part.time_created then part.id
}

export interface SessionReplay {
  session: SessionSummary;
  parentId: string | null; // session.parent_id
  childIds: string[]; // derived: session rows where parent_id === this session's id
  turns: ReplayTurn[]; // ordered by message.time_created then message.id
  tokenAccumulation: Array<{ atTurnIndex: number; tokens: OcTokens }>; // derived: running total walking each turn's step-finish parts
}

export interface SubagentNode {
  sessionId: string; // session.id
  agent: string | null; // session.agent
  model: OcSessionModel | null; // derived: decodeSessionModel(session.model)
  durationMs: number | null; // derived: session.time_updated - session.time_created
  tokens: OcTokens; // session.tokens_*
  cost: OcCost;
  toolCallCount: number; // derived
  children: SubagentNode[]; // derived: recursive, depth-limited to 10 with cycle detection (a cycle surfaces as an OcWarning, not a crash)
}

// ─── Route response types ───────────────────────────────────────────────────

export interface ActivityStats {
  dailyActivity: DailyActivity[];
  hourOfDay: HourBucket[];
  dayOfWeek: DayOfWeekBucket[];
  streaks: StreakSummary;
}

export interface OverviewStats {
  totalSessions: number;
  totalMessages: number;
  totalTokens: OcTokens;
  totalCost: OcCost;
  storedCostComparison: number; // derived: sum of provider-reported session.cost, labelled separately per D3
  activeDays: number; // derived
  avgSessionLengthMs: number | null; // derived
  sessionsThisWeek: number; // derived
  sessionsThisMonth: number; // derived
  unknownAgentCount: number; // derived: sessions with a NULL session.agent
  unknownModelCount: number; // derived: sessions with a NULL session.model
  modelBreakdown: ModelUsage[];
  projectBreakdown: ProjectSummary[];
  dailyActivity: DailyActivity[];
  dailyTokens: Array<{ date: string; tokens: OcTokens }>; // additive OCL-032 amendment: session token totals bucketed by local start date
  hourOfDay: HourBucket[];
  costBreakdown: CostBreakdown;
}

export interface SessionListResponse {
  sessions: SessionSummary[];
  totalCount: number; // derived: total rows matching the filter, independent of pagination
  nextCursor: string | null; // derived: cursor-pagination token, null on the last page
}

export interface SessionDetail extends SessionSummary {
  childIds: string[]; // derived: session rows where parent_id === this session's id
}

export interface ProjectDetail extends ProjectSummary {
  sessions: SessionSummary[];
  dailyActivity: DailyActivity[];
  modelBreakdown: ModelUsage[]; // derived from project-scoped message.data.providerID/modelID, never session.model
  /** `workspace.branch` values for this project. Present only when `workspace` has rows for it; omitted entirely (not `null`, not `[]`) when the table is empty — data-model §1. */
  branches?: string[];
}

export interface FeatureAdoptionRow {
  sessionCount: number; // derived
  pct: number; // derived: sessionCount / total sessions in range
  firstUsed: number | null; // derived: earliest time_created among qualifying sessions
}

export interface FeatureAdoption {
  subagents: FeatureAdoptionRow; // derived: task tool or non-null parent_id
  mcp: FeatureAdoptionRow; // derived: any tool call resolving to a configured MCP server
  webfetch: FeatureAdoptionRow; // derived: any webfetch tool call
  planMode: FeatureAdoptionRow; // derived: message.data.mode
  reasoning: FeatureAdoptionRow; // derived: any reasoning part
  todos: FeatureAdoptionRow; // derived: any todo row
  skills: FeatureAdoptionRow; // derived: any skill tool call
}

export interface VersionRecord {
  version: string; // session.version
  sessionCount: number;
  messageCount: number;
  firstSeen: number; // derived: earliest session.time_created for this version
  lastSeen: number; // derived: latest session.time_created for this version
}

export interface ToolsStats {
  tools: ToolSummary[];
  errors: ToolErrorSummary[];
  activity: ToolActivityPoint[]; // additive OCL-074 amendment for a real per-day error-rate denominator
  mcpServers: McpServerSummary[];
  skills: SkillSummary[];
  featureAdoption: FeatureAdoption;
  versionHistory: VersionRecord[];
}

export interface TodoRollup {
  pending: number;
  inProgress: number;
  completed: number;
  unknown: number; // derived: todo.status values outside the three known statuses
}

export interface SessionTodos {
  sessionId: string; // todo.session_id
  projectId: string; // session.project_id — OCL-080 amendment required for the project filter
  todos: OcTodo[]; // ordered by todo.position
  rollup: TodoRollup;
}

export interface TodosResponse {
  sessions: SessionTodos[];
  rollup: TodoRollup; // derived: rollup across all sessions
}

export type RedactedConfigValue =
  | string
  | number
  | boolean
  | null
  | "[redacted]"
  | RedactedConfigValue[]
  | { [key: string]: RedactedConfigValue };

export interface RedactedConfig {
  agents: string[]; // opencode.jsonc agent block — key names only
  mcpServers: Array<{ name: string; transport: string }>; // opencode.jsonc mcp block — name and transport type only, never the server's env/args
  plugins: string[]; // opencode.jsonc plugin block — names only
  raw: Record<string, RedactedConfigValue>; // the full config tree with every non-allowlisted key replaced by the literal '[redacted]'
}

export interface StorageBreakdown {
  dbBytes: number; // derived: byte size of opencode.db
  walBytes: number; // derived: byte size of opencode.db-wal
  logBytes: number | null; // derived: byte size of log/, null (not 0) when the directory does not exist
  reposBytes: number | null; // derived: byte size of repos/, null (not 0) when the directory does not exist
  totalBytes: number; // derived
}

export interface SettingsResponse {
  dbPath: string | null; // derived: lib/db/locate.ts's resolved path, null when not found
  schemaVersion: string; // derived: lib/db/schema-guard.ts's pinned constant
  opencodeVersion: string | null; // derived: most common session.version in the DB
  storage: StorageBreakdown;
  config: RedactedConfig | null; // derived: null when no opencode.jsonc was found
}

/** A secret-free summary of one live opencode HTTP endpoint. */
export interface LiveEndpointHealth {
  available: boolean; // derived: the configured opencode server returned a successful HTTP response
  items: Array<{
    name: string; // derived: public MCP/LSP identifier only; response values are never forwarded verbatim
    status: string; // derived: allowlisted lifecycle state, or the literal 'unknown'
  }>;
  itemCount: number | null; // derived: array/object size when the response has a collection shape
}

/** Optional `opencode serve` health; no raw upstream response is exposed. */
export interface HealthResponse {
  state: "disabled" | "running" | "not-running"; // derived: configuration and GET availability
  baseUrl: string | null; // derived: credential-free configured origin
  timeoutMs: number; // derived: bounded OC_LENS_OPENCODE_TIMEOUT_MS
  checkedAt: number; // derived: epoch ms, server clock at completion
  mcp: LiveEndpointHealth; // derived: GET /mcp
  lsp: LiveEndpointHealth; // derived: GET /lsp
  agent: LiveEndpointHealth; // derived: GET /agent; names are intentionally not exposed
  config: LiveEndpointHealth; // derived: GET /config; body is intentionally not exposed
}

export interface ExportManifestCounts {
  sessions: number;
  messages: number;
  parts: number;
  todos: number;
}

export interface ExportResponse {
  generatedAt: number; // derived: epoch ms
  schemaVersion: string; // derived
  rangeFrom: number | null; // derived: the requested range's start, in epoch ms
  rangeTo: number | null; // derived: the requested range's end, in epoch ms
  counts: ExportManifestCounts; // derived: also returned alone when ?preview=1 is set
  sessions?: SessionSummary[]; // present when 'sessions' is in the requested scope
  stats?: OverviewStats; // present when 'stats' is in the requested scope
  activity?: ActivityStats; // present when 'activity' is in the requested scope
  tools?: ToolsStats; // present when 'tools' is in the requested scope
  todos?: TodosResponse; // present when 'todos' is in the requested scope
  replays?: SessionReplay[]; // present when 'replay' is in the requested scope
}

// ─── Named per-route response types (see the route table above) ────────────

export type StatsRouteResponse = OcResponse<OverviewStats>;
export type ActivityRouteResponse = OcResponse<ActivityStats>;
export type SessionsRouteResponse = OcResponse<SessionListResponse>;
export type SessionRouteResponse = OcResponse<SessionDetail>;
export type SessionReplayRouteResponse = OcResponse<SessionReplay>;
export type SessionFilesRouteResponse = OcResponse<SessionFilesData>;
/** OCL-100: one requested session and its recursive descendants. */
export type SubagentTreeRouteResponse = OcResponse<SubagentNode>;
/** OCL-100: unpaginated trees for every root session that spawned descendants. */
export type SubagentRootsRouteResponse = OcResponse<SubagentNode[]>;
export type ProjectsRouteResponse = OcResponse<ProjectSummary[]>;
export type ProjectRouteResponse = OcResponse<ProjectDetail>;
export type ToolsRouteResponse = OcResponse<ToolsStats>;
export type SkillsRouteResponse = OcResponse<SkillSummary[]>;
export type TodosRouteResponse = OcResponse<TodosResponse>;
export type CostsRouteResponse = OcResponse<CostBreakdown>;
export type StorageRouteResponse = OcResponse<StorageBreakdown>;
export type SettingsRouteResponse = OcResponse<SettingsResponse>;
export type HealthRouteResponse = OcResponse<HealthResponse>;
export type AgentsRouteResponse = OcResponse<AgentsResponse>;
export type ExportRouteResponse = OcResponse<ExportResponse>;

# test/fixtures

Deterministic, populated opencode-shaped SQLite fixtures — the real dev machine only has 7 sessions, so nothing may be validated against it alone (project-docs/opencode-data-model.md §0).

Run `pnpm fixture` to (re)generate `populated.db` and `empty.db`. Both are gitignored and rebuilt on demand; generation takes well under a second (single transaction, seeded PRNG — `manifest.ts`'s `FIXTURE_SEED`) and is byte-identical across runs.

Use `withFixture(cb)` / `withEmptyFixture(cb)` from `test/fixtures/index.ts` in tests — they build the fixture on first use if it's missing and hand `cb` a read-only `DatabaseSync` connection.

## What `populated.db` guarantees

All minimums live in `manifest.ts`'s `MINIMUMS` — import that constant rather than hardcoding these numbers in a new test.

- 6 projects, including the synthetic `global` project (`worktree: "/"`, `name: null`)
- 120 sessions across ~14 months: ≥8 subagent sessions (non-null `parent_id`), ≥5 archived, ≥10 with NULL `agent`, ≥10 with NULL `model`, ≥4 with a placeholder title (`New session - <ISO>`), ≥3 with exactly one message, exactly one with 400 messages
- ≥4,000 messages and ≥12,000 parts, spanning every verified part type (`text`, `reasoning`, `step-start`, `step-finish`, `tool`, `compaction`, `patch`) across ≥3 providers and ≥6 models (`manifest.ts`'s `PROVIDER_MODELS`)
- ≥1 `compaction` part shaped exactly as confirmed live against a real opencode.db on 2026-08-02 (`manifest.ts`'s `MINIMUMS.compactionParts`): `{ type: "compaction", auto: boolean, overflow: boolean, tail_start_id: string }`
- ≥1 `patch` part shaped exactly as confirmed live against a real opencode.db on 2026-08-02 (`manifest.ts`'s `MINIMUMS.patchParts`): `{ type: "patch", hash: string, files: string[] }`. **Deliberately not tied to any tool call in the same message** — real `patch` parts aren't either; they're a workspace-wide diff snapshot, not per-turn evidence (see data-model.md §5).
- Every core tool (`manifest.ts`'s `CORE_TOOLS`) appears at least once
- MCP-shaped tool names (`manifest.ts`'s `MCP_TOOL_NAMES`) include `linear_docs_search` — the server itself is `linear_docs` (its own name contains an underscore), so naively splitting on the first underscore misreads the server as `linear`. Don't do that; see `lib/tools` (OCL-071) for the real resolver.
- ≥40 tool calls with `state.status === "error"`, plus at least one `pending` and one `running` call
- ≥5 distinct skill names (`manifest.ts`'s `SKILL_NAMES`) via the `skill` tool. **Fixture-only convention, not verified upstream**: the skill name lives at `state.input.name`. OCL-102's own probe against a real opencode instance is still authoritative — if it finds a different key, update this fixture and this note together.
- `todo` rows in all three statuses (`pending`, `in_progress`, `completed`)
- `session_message` rows of both observed types (`agent-switched`, `model-switched`). **The `data` payload shape is fixture-only, not verified upstream** — data-model.md only confirms the `type`/`seq` columns and the two type strings, not what's inside `data`.
- `workspace` and `session_input` tables exist but are empty (0 rows), matching the real dev machine
- Deliberate dirt for decoder testing: one row with malformed JSON in a `data` column, one part with an unrecognised `type`, one assistant message with no `time.completed`

## What `empty.db` guarantees

Every table from the schema exists with zero rows — nothing else.

## Not in scope here

`file`, `agent`, and `snapshot` parts are still ⚠️ UNVERIFIED (data-model.md §5) and are **not** in this fixture — a future ticket adds them once its own probe confirms the real shape; do not invent them here in the meantime. `compaction` and `patch` were both confirmed live on 2026-08-02 and are now included above.

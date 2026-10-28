# opencode data model — verified reference

**This is the evidence base for every data-layer ticket in [backlog.md](./backlog.md).** Everything marked ✅ VERIFIED was read directly out of the live opencode database on the maintainer's machine on 2026-08-01. **opencode 2.x replaced the transcript tables — see §8 (verified 2026-10-26) before touching any query.** Everything marked ⚠️ UNVERIFIED is claimed by upstream docs or by the vault synthesis note but was **not** observable in the sample available. Do not code against an ⚠️ shape without running the probe step named in its ticket first.

## 0. Environment as measured

| Fact | Value | How measured |
|---|---|---|
| opencode version | `1.17.7` | `opencode --version` (npm global `opencode-ai@1.17.7`) |
| DB path | `~/.local/share/opencode/opencode.db` | directory listing |
| Journal mode | WAL (`-wal` + `-shm` present) | file listing |
| Config path | `~/.config/opencode/opencode.jsonc` | directory listing |
| Other data | `~/.local/share/opencode/{log,repos}/` | directory listing |
| Row counts | project 2 · session 7 · message 17 · part 47 · todo 0 · session_message 14 · session_input 0 · workspace 0 · event 164 · permission 0 | `select count(*)` after copying db+wal+shm |

**The dev machine's dataset is tiny.** A prior synthesis note claimed 15 projects / 98 sessions / 2410 messages / 8915 parts; that is not what is on disk now. Two consequences for the build:

1. **Never size, paginate, or optimise against the local DB.** Use the fixture generator (OCL-013) for volume.
2. **Any claim of the form "column X is always 0 / always NULL in practice" is unsupported.** For example `tokens_cache_read` sums to 25,472 here (not zero), and `agent`/`model` are non-NULL on all 7 sessions (no "thin legacy rows"). Build every panel to render honestly on both empty and populated data rather than hard-coding an assumption.

## 1. Tables

Full DDL is reproducible with `select sql from sqlite_master where type='table'`. The tables oc-lens reads:

| Table | Read by oc-lens? | Notes |
|---|---|---|
| `project` | ✅ yes | `id`, `worktree`, `vcs`, `name`, `icon_*`, `time_*`, `sandboxes`, `commands` |
| `session` | ✅ yes | the analytics spine — see §2 |
| `message` | ✅ yes | `id`, `session_id`, `time_created`, `time_updated`, `data` (JSON) |
| `part` | ✅ yes | `id`, `message_id`, `session_id`, `time_created`, `time_updated`, `data` (JSON) |
| `todo` | ✅ yes | `session_id`, `content`, `status`, `priority`, `position`, `time_*` |
| `session_message` | ✅ yes | lifecycle events — `type`, `seq`, `data`. Observed types: `agent-switched` (7), `model-switched` (7) |
| `workspace` | ⚠️ empty here | `branch`, `directory`, `type` — the only branch source. 0 rows on this machine |
| `session_input` | ⚠️ empty here | 0 rows. **Do not** build prompt history on this table |
| `event`, `event_sequence` | ❌ no | internal event log |
| `permission` | ❌ no | 0 rows; also per-project policy, not analytics |
| `session_context_epoch`, `session_share`, `project_directory`, `data_migration`, `migration` | ❌ no | not analytics |
| **`account`, `account_state`, `control_account`, `credential`** | ❌ **HARD DENY** | these hold `access_token`, `refresh_token`, and credential `value`. See §6 |

## 2. `session` — ✅ VERIFIED

Real row, verbatim:

```json
{
  "id": "ses_0d06ca2ceffeU1c9LR0kNdi1nZ",
  "project_id": "global",
  "workspace_id": null,
  "parent_id": null,
  "slug": "crisp-otter",
  "directory": "/tmp/.../oc-test",
  "path": "tmp/.../oc-test",
  "title": "New session - 2026-07-05T00:00:14.641Z",
  "version": "1.17.7",
  "share_url": null,
  "summary_additions": 0,
  "summary_deletions": 0,
  "summary_files": 0,
  "summary_diffs": null,
  "metadata": null,
  "cost": 0.0,
  "tokens_input": 7912,
  "tokens_output": 6,
  "tokens_reasoning": 15,
  "tokens_cache_read": 0,
  "tokens_cache_write": 0,
  "revert": null,
  "permission": "[{\"permission\":\"question\",\"pattern\":\"*\",\"action\":\"deny\"}, ...]",
  "agent": "build",
  "model": "{\"id\":\"deepseek-v4-flash-free\",\"providerID\":\"opencode\",\"variant\":\"default\"}",
  "time_created": 1783209614641,
  "time_updated": 1783209617326,
  "time_compacting": null,
  "time_archived": null
}
```

Decoding rules that every query must honour:

- **`time_*` are epoch milliseconds** (integers), not ISO strings. All grouping by day/hour must apply the viewer's local timezone explicitly — never `date(time_created)` on the raw integer.
- **`model` is a JSON string blob**, not a plain model id: `{"id","providerID","variant"}`. It is nullable. Prefer `message.data.modelID` + `.providerID` for per-model analytics; use `session.model` only as a session-level label with a null fallback.
- **`permission` is a JSON string array.** Not needed for v1.
- **`title` is a real generated title** but may be a placeholder of the form `New session - <ISO>`. Detect that pattern and fall back to the first user text part.
- **`parent_id`** is the subagent link (`NULL` for a root session). This is what OCL-100 renders.
- **`agent`** is the agent name (`build`, `plan`, …). Nullable — bucket nulls as `unknown`, never as a silent default.
- **`slug`** is a human-friendly session handle (`crisp-otter`); good for URLs and search.
- **`time_archived`** non-null means archived; decide per view whether to include (default: include, with a filter).

## 3. `project` — ✅ VERIFIED

```json
{
  "id": "global",
  "worktree": "/",
  "vcs": null,
  "name": null,
  "time_created": 1781621976122,
  "time_updated": 1783209779042,
  "time_initialized": null,
  "sandboxes": "[]",
  "commands": null
}
```

- **There is a synthetic `global` project** with `worktree = "/"` and `name = null`. It is not a real directory. Display naming must be: `name` → else `basename(worktree)` → else the literal `global` for `id = 'global'`. Do not render `/` as a project name.
- **No slug decoding is needed.** cc-lens's `lib/decode.ts` exists only because Claude Code encodes project paths into directory slugs. opencode stores `worktree` and `session.directory` verbatim. **Do not port `decode.ts`.**
- `vcs` is nullable and was null here — do not rely on it to detect a git repo.

## 4. `message.data` — ✅ VERIFIED

**Assistant message:**

```json
{
  "parentID": "msg_f2f935f34001dJ3sEIRokroWdR",
  "role": "assistant",
  "mode": "build",
  "agent": "build",
  "path": { "cwd": "/…/oc-test", "root": "/" },
  "cost": 0,
  "tokens": {
    "total": 7933, "input": 7912, "output": 6, "reasoning": 15,
    "cache": { "write": 0, "read": 0 }
  },
  "modelID": "deepseek-v4-flash-free",
  "providerID": "opencode",
  "time": { "created": 1783209615279, "completed": 1783209617176 },
  "finish": "stop"
}
```

**User message:**

```json
{
  "role": "user",
  "time": { "created": 1783209615156 },
  "agent": "build",
  "model": { "providerID": "opencode", "modelID": "deepseek-v4-flash-free" },
  "summary": { "diffs": [] }
}
```

Notes:

- `role` ∈ {`user`, `assistant`} in the sample. Treat any other value as `unknown` rather than throwing.
- **Token shape differs from Claude Code**: it is `tokens.cache.{read,write}`, *not* `cache_read_input_tokens`. `tokens.total` is present but recompute rather than trust it.
- `time.completed` is **absent on user messages and on in-flight assistant messages** — turn duration must be null-safe.
- `modelID`/`providerID` on the assistant message is the clean per-turn model source (use this, not `session.model`).
- `mode` and `agent` are both present and were equal here; they are not guaranteed equal (`mode` is the run mode, `agent` the agent name). Read `agent` for agent analytics, `mode` for plan-mode detection.
- `parentID` on a message links a subagent message back to its parent turn.
- `summary` on a user message carried `{ "diffs": [] }`; the vault synthesis describes `message.data.summary` as a compaction-summary flag. **Both cannot be assumed** — probe before using (see OCL-055).

## 5. `part.data` — types observed

Observed distribution across 47 parts: `text` 14 · `step-start` 10 · `reasoning` 10 · `step-finish` 10 · `tool` 3.

### ✅ VERIFIED — `text`

```json
{ "type": "text", "text": "…" }
```

### ✅ VERIFIED — `reasoning`

```json
{ "type": "reasoning", "text": "…", "time": { "start": 1783209616914, "end": 1783209617111 } }
```

### ✅ VERIFIED — `step-start` / `step-finish`

```json
{ "type": "step-start" }
```

```json
{
  "reason": "stop", "type": "step-finish", "cost": 0,
  "tokens": { "total": 7933, "input": 7912, "output": 6, "reasoning": 15,
              "cache": { "write": 0, "read": 0 } }
}
```

`step-finish` carries **per-step** cost and tokens. This is the finest-grained cost signal available and is what the token-accumulation chart (OCL-056) should walk.

### ✅ VERIFIED — `tool`

```json
{
  "type": "tool",
  "tool": "write",
  "callID": "call_00_hsbVhWA52OF29N1XTRvE7557",
  "state": {
    "status": "completed",
    "input": { "filePath": "/…/fizzbuzz.py", "content": "…" },
    "output": "Wrote file successfully.",
    "metadata": { "diagnostics": {}, "filepath": "/…/fizzbuzz.py", "exists": false, "truncated": false },
    "title": "tmp/…/fizzbuzz.py",
    "time": { "start": 1783209635239, "end": 1783209635254 }
  }
}
```

- **`state.time.start/end` gives a real per-tool-call duration.** cc-lens has no equivalent. This is a genuine upgrade (OCL-054).
- `state.status` ∈ {`completed`, `error`, `pending`, `running`} per upstream; only `completed` was observed here. Error parts carry a message in `state.output`/`state.error` — **probe before building OCL-074**.
- `tool` names are **lowercase** (`read`, `write`, `edit`, `bash`, `grep`, `glob`, `webfetch`, `todowrite`, `task`, `skill`, `question`). cc-lens's `TOOL_CATEGORIES` map is keyed on Claude Code's PascalCase names and **must be rewritten**, not ported.
- MCP tools appear as `<server>_<tool>` (e.g. `serena_find_symbol`) — **ambiguous**, since server and tool names can both contain underscores. Resolve server names from the config `mcp` block (or `GET /mcp`) and longest-prefix match. **Never split on the first underscore.** See OCL-071.

#### ✅ VERIFIED 2026-08-20 — `state.input` key names per tool

Read from the maintainer's real `opencode.db` (13 sessions, 508 tool calls, opencode 1.17.7) through oc-lens's own redaction-safe diagnostics endpoint, which reports key *names* and counts only and never values.

**Every tool recorded a non-empty `state.input` — 508 of 508 calls.** This corrects an assumption the generated fixture had encouraged: the fixture emits `input: {}` for `glob`, `grep`, `task`, `todowrite`, `question` and the MCP tools, which is a fixture limitation and **not** how opencode behaves.

| Tool | `state.input` keys observed | Calls |
|---|---|---|
| `read` | `filePath`, `offset`, `limit` | 435 |
| `bash` | `command`, `description`, `timeout`, `workdir` | 26 |
| `grep` | `pattern`, `path`, `include` | 22 |
| `glob` | `pattern`, `path` | 15 |
| `todowrite` | `todos` | 4 |
| `task` | `description`, `prompt`, `subagent_type` | 3 |
| `write` | `content`, `filePath` | 3 |

Consequences for anything comparing calls to each other: `read` carries `offset`/`limit`, so two reads of different chunks of one file are legitimately different calls; and no key resembling a nonce, request id, or timestamp appeared in any tool, so identical calls do hash identically. `edit` was not exercised in this sample, so its key set remains unobserved live (the fixture uses `filePath` + `content`). No `question`, `skill`, or MCP call appeared either, so those stay unverified.

#### ✅ VERIFIED 2026-08-20 — `state.metadata` key names, and the exit code

Same read-only, values-free method as the `state.input` table above.

| Tool | `state.metadata` keys observed |
|---|---|
| `read` | `display` (object), `loaded` (array), `preview` (string), `truncated` (boolean) |
| `bash` | `description` (string), **`exit` (number)**, `output` (string), `truncated` (boolean) |
| `grep` | `matches` (number), `truncated` (boolean) |
| `glob` | `count` (number), `truncated` (boolean) |
| `todowrite` | `todos` (array), `truncated` (boolean) |
| `task` | `model` (object), `parentSessionId` (string), `sessionId` (string), `truncated` (boolean) |
| `write` | `diagnostics` (object), `exists` (boolean), `filepath` (string), `truncated` (boolean) |

**`bash` records the process exit code at `state.metadata.exit`, and this is the only honest way to tell a failed command from a successful one.** `state.status` is `completed` whenever the *tool* ran, regardless of what the command inside it returned — every one of the 26 real `bash` calls was `completed`. A build retried until it passes is therefore invisible to a status-only check. `lib/loops/outcome.ts` narrows this single field (numeric and finite only) and treats a non-zero value as a failure; tools that record no exit code fall back to `state.status` rather than being guessed at from output text.

`truncated` appears on every tool. `grep`'s `matches` and `glob`'s `count` are potentially useful "found nothing" signals, unused so far.

#### ⚠️ FIXTURE-VERIFIED ONLY — `skill` invocation name

The generated OCL-013 fixture stores the invoked skill name at `part.data.state.input.name` for `part.data.tool = "skill"`. OCL-102 uses that exact key and buckets missing, blank, or non-string values as the literal `unknown`. This convention is **not verified against an upstream live opencode skill call**: the maintainer's observed live sample did not establish the skill-specific input shape, so this must not be promoted to ✅ live-verified without a probe.

### ⚠️ UNVERIFIED — `file`, `agent`, `snapshot`

(`patch` and `compaction` were confirmed live on 2026-08-02 — see the dated notes below.)

The vault synthesis claims `part.data.type='patch'` (with `files[]` + `hash`) and `'compaction'` (with `{auto, overflow}`) exist. **Neither appeared in the 47 parts on this machine.** Tickets OCL-055 (compaction cards) and OCL-103 (file-change timeline) each begin with a mandatory probe step: generate real sessions that produce those parts, dump the shapes, and record them back into this document before writing the renderer.

**OCL-103 controlled probe — 2026-08-01, negative:** the repository's populated fixture contains 13,068 parts (`tool`, `text`, `reasoning`, `step-start`, `step-finish`, plus one deliberate unknown fixture type) and no `part.data.type='patch'` row. It contains 170 `write` and 174 `edit` tool calls. No developer database or external opencode process was accessed, so this does not upgrade the unverified patch-part shape. OCL-103 therefore uses only the already verified `write`/`edit`/`patch` tool-call fallback fields `state.input.filePath` and `state.metadata.filepath`; the fixture remains unchanged rather than inventing a patch part.

**2026-08-01 — OCL-055 compaction probe: not reproducible within the authorized evidence boundary.** Driving an external opencode process or reading the developer's real database was not authorized for this run. A read-only inspection of the checked-in populated fixture found 13,067 verified parts (`text`, `reasoning`, `step-start`, `step-finish`, `tool`) plus one deliberate unknown part and **zero** `compaction` parts. The fixture's 2,050 messages with `message.data.summary` all use the synthetic `{ "diffs": [] }` user-message shape already documented in §4; they are not evidence of compaction semantics. Consequently `compaction` remains an unknown part handled by the labelled fallback. No compaction type, decoder, renderer, or fixture payload was added.

**2026-08-02 — `compaction` shape confirmed live, at the maintainer's explicit request, against their own real `opencode.db`.** A read-only query of `part` rows where `json_extract(data,'$.type')='compaction'` returned real rows with exactly these keys: `{ type: "compaction", auto: boolean, overflow: boolean, tail_start_id: string }`. `auto` marks whether the compaction was triggered automatically (vs. user-invoked); `overflow` marks whether it ran because the context window overflowed; `tail_start_id` is the `message.id` of the first message retained after the compacted head. This matches the vault synthesis's guessed `{auto, overflow}` plus one previously-unknown field (`tail_start_id`). **Update:** OCL-055's decoder (`lib/decode/compaction.ts`), renderer (`components/sessions/replay/compaction-card.tsx`), and one deterministic fixture row were built the same day and are verified end to end (unit tests plus a live render against the real session that originally showed the caveat banner).

**2026-08-02 — `patch` shape confirmed live, same method, same session.** A read-only query of `part` rows where `json_extract(data,'$.type')='patch'` returned 3 real rows, all with exactly these keys: `{ type: "patch", hash: string, files: string[] }` — matching the vault synthesis's original guess exactly. Sample: `{ "type": "patch", "hash": "094c0ec1231b737617bded055272857a3c644f8a", "files": ["/absolute/path/to/file.ts"] }`.

**Critical follow-up finding, same day:** cross-referencing the three real `patch` rows against their owning messages found `patch` is **not scoped to the owning session or message**. The exact same `hash`/`files` pair (`094c0ec1231b737617bded055272857a3c644f8a` / `lib/pricing/__tests__/route.test.ts`) appears attached to messages in **two different sessions** (`ses_03d43ec0…` and `ses_03d463d3…`). One occurrence sits on a message whose own tool calls were two `task` (subagent delegation) calls — neither of which touched that file; a *different* occurrence sits on a message whose own tool call was a plain `read` of an unrelated file. The evidence is consistent with `patch` being a workspace-wide git-diff snapshot taken opportunistically (e.g. after a subagent completes), not a record of "this message's/session's own edits." **Consequently `fileChanges()` (OCL-103) does not use `patch` parts as file-change-timeline evidence** — doing so would misattribute another session's (or a subagent's) changes as this session's own. `lib/decode/patch.ts` decodes it as a verified type (`types/oc.ts`'s `OcPartPatchData`) and `components/sessions/replay/patch-card.tsx` renders it in replay as an honestly-labelled "workspace diff snapshot," explicitly not as a per-session change list. OCL-103's `fileChanges()` continues to use only the verified `write`/`edit`/`patch`-tool-call fallback (`state.input.filePath`/`state.metadata.filepath`), which remains the only source that's actually attributable to the session being viewed.

**2026-08-03 — two confirmed-shape fields turned out to be optional, not required, based on real user reports filed through the app's own "Report on GitHub" flow (not a direct developer-machine probe).** Both were being incorrectly rejected as malformed:

- **`compaction`'s `tail_start_id` is absent on some real rows.** A real row reported live was exactly `{ "type": "compaction", "auto": true, "overflow": true }` — no `tail_start_id` key at all. The decoder (`lib/decode/compaction.ts`) previously required all three of `auto`/`overflow`/`tail_start_id`, so this row was rejected as `malformed-compaction` and doubly counted as `unknown-part-type: compaction` (the fallback path tags both). It now requires only `auto`/`overflow` as booleans; `tail_start_id` decodes to `tailStartId: null` when the key is absent, and is still rejected as malformed only if present with the wrong type. `types/oc.ts`'s `OcPartCompactionData.tailStartId` is now `string | null`. `components/sessions/replay/compaction-card.tsx` renders an honest fallback sentence when it's `null` instead of interpolating nothing into the message-id slot.
- **`session.model`'s `variant` is absent for at least one real custom (non-catalog) provider.** A real row reported live was `{ "id": "custom-model", "providerID": "custom-proxy" }` — a self-hosted custom-proxy proxy model with no `variant` key at all. The decoder (`lib/decode/session.ts`) previously required `id`/`providerID`/`variant` all present, so this row was rejected as `malformed-session-model`. It now only requires `id`/`providerID`; `variant` decodes to `null` when the key is absent. `types/oc.ts`'s `OcSessionModel.variant` is now `string | null`. No renderer change was needed — `app/sessions/[id]/page.tsx`'s model badge already used a truthy check (`session.model.variant ? …` ) that treats `null` the same as the old empty string never actually observed.

Neither finding changes what counts as genuinely malformed: a `tail_start_id` or `variant` present with the wrong JSON type is still flagged. Only "key absent entirely" moved from malformed to a legitimate optional-field shape.

## 6. Security — non-negotiable

- **The DB is opened read-only. Always.** `new DatabaseSync(path, { readOnly: true })` (or the `?mode=ro` URI equivalent). There is exactly one SQLite file holding the user's entire agent history; the blast radius of a write bug is total.
- **Hard denylist, enforced in the connection layer, not by convention:** the tables `account`, `account_state`, `control_account`, `credential` must never be selected from, and `~/.local/share/opencode/auth.json` / `account.json` must never be read. OCL-017 makes this a test, not a comment.
- **Config rendering must redact.** `opencode.jsonc` provider blocks hold API keys. The settings reader (OCL-110) redacts by allowlist — never by blocklist regex — before anything leaves the server.
- **oc-lens's only write path** is its own config file at `~/.config/oc-lens/config.json` (user-entered model prices). The path is a constant; no user input ever reaches a filesystem path.

## 7. HTTP API (optional, live features only)

`opencode serve` exposes `GET /session`, `/session/:id/message`, `/session/:id/todo`, `/session/:id/diff`, `/project`, `/config`, `/agent`, `/mcp`, `/lsp`, an SSE stream at `/global/event`, and OpenAPI at `/doc`. **oc-lens does not require it.** It is used only by OCL-112 (live MCP/LSP/agent health), which must degrade to a clean "opencode server not running" state rather than erroring.

## 8. opencode 2.x — `session_v2` + `session_message` — ✅ VERIFIED 2026-10-26

Issue [#26](https://github.com/ibrahimkobeissy/oc-lens/issues/26). Evidence came from three sources, and each claim below names which one it rests on:

1. **Exact DDL**: a database created by **opencode 2.1.4** itself (`opencode models --standalone` with every `XDG_*` directory pointed at an empty scratch directory). No user data involved. `test/fixtures/v2-fixture.ts` copies this DDL verbatim.
2. **Payload shapes**: a values-free probe of the maintainer's real, upgraded `opencode.db` (opencode 2.1.4; 112 `session_v2` rows, 1,514 `session_message` rows), reading it read-only. Same method as the 2026-08-20 probes: only key paths, JSON types, row counts, and enum-like labels (`type`, `status`, `reason`, `finish`, `outcome`) were printed — never text, inputs, outputs, paths, or ids. The four denylisted tables were never selected from.
3. **Upstream source** ([`packages/core/src/session/sql.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/sql.ts), [`packages/schema/src/session-message.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/schema/src/session-message.ts), `dev` branch) — used only for shapes the probe did not observe, and marked **UPSTREAM-SOURCE ONLY** below. `dev` already differs from 2.1.4 (e.g. 2.1.4 writes a `recent` field on `compaction` that `dev`'s schema does not declare), so source is weaker evidence than the probe.

**DB location is unchanged**: 2.1.4 created `$XDG_DATA_HOME/opencode/opencode.db`, and the maintainer's install uses `~/.local/share/opencode/opencode.db` — exactly `lib/db/locate.ts`'s existing order. No channel-specific path was observed, so none was added.

### 8.1 Tables

A **fresh 2.x database has no `session`, `message`, `part`, or `todo` table at all.** Its tables: `project`, `session_v2`, `session_message`, `session_inbox`, `session_pending`, `instruction_blob`/`_entry`/`_state`, `kv`, `event`, `event_sequence`, `permission`, `project_directory`, `worktree`, `workspace`, `migration`, and the denylisted `account`, `account_state`, `control_account`, `credential`. oc-lens reads only `project`, `session_v2`, and `session_message`.

- `session_v2` carries **every** 1.x `session` column (so the schema guard checks the same list) plus `fork_session_id`, `fork_boundary`, `time_idle`, `time_viewed`, `idle_outcome` (`succeeded`/`failed`/`interrupted`/NULL), `time_suspended`, `resume_attempts`. **`title` is nullable** in 2.x.
- `session_message`: `id` (`msg_…`, ascending), `session_id`, `type`, `seq` (unique per session — the ordering key), `time_created`, `time_updated`, `data` (JSON, with `type` and `id` stripped). On the real DB `time_created` always equalled `data.time.created`, and seq order never contradicted time order.
- `workspace` was **rebuilt**: `id, provider, binding, created_at, last_used_at` — no `project_id`, no `branch`. The 1.x branch list is only read when those columns exist.
- `project` gained `icon_url_override`, `time_active`, `time_archived`; every column oc-lens reads is unchanged.

### 8.2 An upgraded database is mixed — and the overlap is exact

Upgrading a 1.x install keeps the legacy tables and **copies** into the 2.x ones. Measured on the real DB:

| Fact | Count |
|---|---|
| legacy `session` rows / also present in `session_v2` under the same id | 82 / 82 |
| `session_v2` rows that exist only in 2.x | 30 |
| legacy `message` rows / present in `session_message` under the same id | 615 / 610 |
| legacy sessions whose `session_v2` row has different tokens or a later `time_updated` | 0 |
| `session_message` rows inside legacy sessions that are *not* legacy messages | 58 (54 `system`, 4 `synthetic`), all timestamped at or before that session's last legacy message |

So the migration maps 1.x → 2.x one-to-one by id: a legacy user message becomes `user`, a user message carrying a `compaction` part becomes a `compaction` row, a synthetic user message becomes `synthetic`, an assistant message becomes `assistant`. It also synthesises `system` rows inside legacy sessions that 1.x never had.

**Deduplication rule** (`lib/db/canonical.ts`): `session_v2` is the session spine; a legacy-only session is added only if its id is missing from `session_v2`. A session's legacy `message`/`part` rows win, and a `session_message` row is projected only when its id is not a legacy message id **and** the session has no legacy messages or the row is newer than the session's last legacy message (a 1.x session continued under 2.x). This keeps the migration-synthesised rows out of 1.x analytics without dropping a post-upgrade continuation.

### 8.3 `session_message.type` — observed distribution and shapes

Observed on the real DB: `assistant` 1,253 · `user` 126 · `system` 55 · `idle` 47 · `synthetic` 27 · `compaction` 6. **Not observed:** `agent-switched`, `model-switched`, `location-switched`, `skill`, `shell` (all UPSTREAM-SOURCE ONLY).

| type | keys observed (✅) or declared upstream (⚠️) | oc-lens reads it as |
|---|---|---|
| `user` | ✅ `text`, `time.created`, optional `files[]`, `agents[]` | user message + one `text` part. **No `agent`** — the next assistant step's agent stands in |
| `synthetic` | ✅ `text`, `time`, optional `description`, `metadata` | user message + `text` part (the migration proves 1.x stored these as user messages) |
| `assistant` | ✅ `agent`, `model{id,providerID,variant}`, `content[]`, `time{created,completed?,streamed?}`, optional `cost`, `tokens`, `finish`, `rawFinish`, `snapshot{start,end,files}`, `error{type,message,status?,response?}` | one assistant message **per step** (`finish` was `tool-calls` 1,134 / `stop` 92 / `error` 15) with `step-start` · content parts · `step-finish` |
| `compaction` | ✅ `reason` (`auto` 6), `status` (`completed` 6), `summary`, `recent`, `time`; optional `model`, `cost`, `tokens` (1 of 6) | user message with a `compaction` part (`auto` from `reason`, **`overflow` absent → `null`**), plus an assistant `-summary` message carrying the summary text and the compaction request's usage — 1.x's own pairing |
| `idle` | ✅ `outcome` (`succeeded` 32 / `failed` 14 / `interrupted` 1), `time`, optional `error` | lifecycle event, never a message |
| `system` | ✅ `text`, `time`, optional `description`, `metadata` | lifecycle event |
| `agent-switched` | ⚠️ `agent`, `previous?`, `time` | lifecycle event; also `agentSwitchEvents()` |
| `model-switched` | ⚠️ `model`, `previous?`, `time` | lifecycle event |
| `location-switched` | ⚠️ `location`, `projectID?`, `subpath?`, `previous?` | lifecycle event |
| `skill` | ⚠️ `skill`, `name`, `text` | lifecycle event |
| `shell` | ⚠️ `shellID`, `command`, `status`, `exit?`, `output?`, `time{created,completed?}` | lifecycle event (user-run `!command`, not a model tool call) |
| anything else | — | lifecycle event of kind `unknown` + an `unknown-session-event` warning; never dropped |

Lifecycle events are **not** projected into `message`: in 1.x every `message` row is a user/assistant turn, and counting `idle` markers as messages would silently inflate message counts, agent buckets, and activity charts. Replay reads them from the `oc_session_event` view and places each before the first message created after it.

**Usage**: `tokens` is `{input, output, reasoning, cache{read, write}}` — the 1.x shape minus `total`. 16 real assistant steps (provider errors and in-flight steps) carry **no `tokens` and no `cost`**; they are projected with `usage: "none"` so pricing reads them as "nothing reported" instead of marking the whole rollup unpriced. `cost` was `0` on every row (D3 unchanged).

### 8.4 `assistant.content[]` — ✅ VERIFIED

Observed item types: `tool` 2,072 · `reasoning` 796 · `text` 409.

- `text`: `{type, text}` → 1.x `text` part.
- `reasoning`: `{type, text, time{created, completed}}`, sometimes `native{…}` or `state{reasoningField}` → 1.x `reasoning` part (`time.start/end` from `created/completed`).
- `tool`: `{type, id, name, executed?, state, time{created, ran?, completed?}}`, where `state` is `{status, input, content?[{type:"text", text}], metadata?, error?{type, message}}`. Projected to the 1.x tool part: `tool` ← `name`, `callID` ← `id`, `state.output` ← the joined `content[].text`, `state.error` ← `error.message`, `state.time.start/end` ← `ran ?? created` / `completed`, `input` and `metadata` byte-for-byte (the loop signature and the exit code depend on them).

`state.status` observed: `completed` 2,016 · `error` 56. Upstream also declares `running` and `streaming`; a `streaming` call records `input` as a **partial JSON string**, so it is projected as `pending` and is unsignaturable for loop detection. Error `type`s observed: `tool.execution` 53, `permission.rejected` 2, `tool.interrupted` 1.

**Tool names changed in 2.x.** Observed: `shell` (894 — replaces `bash`; `metadata` = `{exit, status, truncated}`), `subagent` (21 — replaces `task`; `input` = `{agent, description, prompt, background?}`, `metadata.sessionID` = the child session), `execute` (11 — runs model-written code; `input.code`, `metadata.toolCalls[]`), plus the 1.x names (`read`, `write`, `edit`, `grep`, `glob`, `todowrite`, `question`, `skill`, `webfetch`, MCP `<server>_<tool>`) and `list_mcp_resources`. **`state.metadata.exit` is still the only honest failure signal**: all 894 `shell` calls had `status: "completed"`, 35 of them with a non-zero exit.

Input-key changes that matter: `read`/`write`/`edit` name the file at `filePath` **or `path`** (73 reads, 8 writes, 5 edits used `path`), so `targetPath()` and the file-change timeline read both; `skill` names the skill at `name` (9) or `id` (3).

**Todos**: 2.x has no `todo` table. The `todowrite` call's `state.metadata.todos` (and `state.input.todos`) is `[{content, status, priority}]`, so a 2.x session's list is derived from its last completed `todowrite` call. A legacy `todo` table, when present, wins for its sessions.

**Snapshots** — ✅ VERIFIED: `assistant.snapshot` is `{start?, end?, files?}` (git tree hashes; `files` is a mix of relative and absolute paths). 960 steps carried one; only 39 listed changed files. A step with changed files is projected as a 1.x `patch` part (`hash` ← `end ?? start`), because it is the same working-tree diff 1.x stored that way: rendered as a labelled workspace snapshot, never used by the file-change timeline (§5).

**Attachments** — ✅ VERIFIED EMPTY: all 126 real `user` rows had `files: []`/`agents: []` or none at all; nothing populated was observed and the `blob` tables were absent, so no attachment renderer was built. Upstream declares `FileAttachment`/`MediaRef` shapes; add a renderer only after a probe sees one.

Not projected, and why: `native` provider blobs (opaque, provider-specific), `session_inbox`/`session_pending` (queued input, not history).

### 8.5 Materialisation and export

The 2.x projection is cached per connection in in-memory TEMP tables (`temp_store = MEMORY`) and rebuilt only when `PRAGMA data_version` shows another connection — opencode — committed. Re-deriving it from JSON on every query cost ~150 ms per full `part` scan on the maintainer's 2,845-part legacy + 3,138-part 2.x history, against ~40 ms for the raw legacy table; cached, pages measured roughly 2x faster after a one-off ~200 ms build.

`GET /api/export` streams lifecycle events as replay turns in the same positions as `getReplay()`. `ExportManifestCounts.events` counts them (0 on a 1.x database) and `parts` includes them, one part each, so preview counts still equal what is streamed.

### 8.6 opencode's session import format — ✅ VERIFIED 2026-10-28 (opencode 2.2.0)

`GET /api/sessions/[id]/opencode-export` produces input for `opencode session import <file>` (`lib/queries/session-transfer.ts`). Evidence, all values-free:

1. **Schema** read from the installed 2.2.0 binary: the CLI posts the file's `{info, messages}` to `POST /api/experimental/session/import`, decoded as `SessionTransfer.Data` = `{info: Session.Info, messages: SessionMessage[]}`. `Session.Info` fields: `id, parentID?, fork?{sessionID, boundary}, projectID, agent?, model?, cost, tokens{input, output, reasoning, cache{read, write}}, outcome?, time{created, updated, idle?, viewed?, archived?}, title?, location, subpath?, metadata?, permissions?, revert?`. The 1.x `{info, messages:[{info, parts}]}` export format is **not** accepted.
2. **Mapping** from `session_v2` columns, checked by deep-comparing against `opencode session export` for 54 real sessions: `parentID`←`parent_id`, `fork`←`fork_session_id`+`fork_boundary` (JSON), `projectID`←`project_id`, `model`/`metadata`/`permissions`/`revert` ← JSON columns `model`/`metadata`/`permission`/`revert`, `outcome`←`idle_outcome`, `time.*`←`time_*`, `location`←`{directory}`, `subpath`←`path` **only when non-empty** (41 global-project sessions carry one; 72 project-root sessions store `""` and export none). Absent optionals are omitted, never `null`.
3. **Messages** are every `session_message` row of the session in `seq` order, `{...data, id, type}` — opencode's export includes `system`/`idle`/lifecycle rows and migration-synthesised rows. The only remaining differences from opencode's own export are older field names it rewrites on read (`state`→`native` on text/reasoning content, `providerState`/`providerResultState`→`native` on tools, `recent`→`metadata.recent` on compaction); its import decoder applies the same upgrade, so rows are passed through unchanged.
4. **Round trip**: exports imported into an isolated opencode (`--standalone`, every `XDG_*` dir in a scratch directory) kept the session id and every message in order (11 and 137 messages). opencode's own CLI export produced truncated, invalid JSON for 6 of 60 large sessions; this route does not.

Import order: a session with `parentID` imports only after its parent exists. A legacy-only session (no `session_v2` row) or a pure 1.x database has nothing in this format, so the route answers 409 `export_unavailable` rather than inventing a 2.x record.

### 8.7 Failed provider calls and retries — ✅ VERIFIED 2026-10-28 (opencode 2.2.0)

Values-free probe of the maintainer's DB plus the 2.2.0 binary. Read by `lib/queries/failures.ts` (`/audit`).

- **A finally-failed model call is saved** as an assistant step with an `error`. 2.x: `error{type, message, status?, response?}` — types observed `provider.rate-limit` 13 (all `status` 429), `provider.internal` 1 (500), `provider.invalid-request` 1 (422), `provider.error` 2, `aborted` 3. 1.x: `error{name, data{message, statusCode?, isRetryable?, responseHeaders?, responseBody?, metadata?}}` — names `APIError` (401, and one with no status) and `MessageAbortedError`. `response`, `responseHeaders` and `responseBody` are **never read**: they are raw provider payloads.
- **Failed steps record no usage**: 16 of 20 carry no `tokens`, the other 4 carry all-zero tokens. A failed step that *does* report usage is surfaced as a warning, never assumed away.
- **Retries inside a step are only sometimes persisted.** 2.2.0 emits `session.retry.scheduled {sessionID, assistantMessageID, attempt, at, error}`; the `event` table stays empty. On the maintainer's DB no message carried a retry. **Corrected 2026-10-28** from two real 2.x session exports from another machine (589 and 41 messages, imported with `opencode session import`): one assistant step carried `retry{attempt, at, error{type, message, status}}` — the *last* retry scheduled in that step. Read it as "at least `attempt` failed attempts". A step whose `retry` is set but which has no `error` and does have `tokens` **retried and then succeeded**: its failures are invisible without this field.
- **`provider.transport` with `status: 200`** (observed once, with `retry.attempt` 6): the provider accepted the request (HTTP 200) and the stream broke mid-response. The step recorded no `tokens`; one of its tool parts carried `state.error.type: "provider.transport"`. Accepted attempts with no recorded usage are the likeliest invisible charges, so they are reported with an **estimate**: attempts × the context size (`input + cache.read + cache.write`) of the last successful step before — always labelled an estimate.
- **`synthetic` turns are mostly not resends.** On the export, 17 of 18 were opencode's plan-mode reminders after `agent-switched`/`model-switched`/`system`, and 1 — directly after the failed step — was opencode's "The previous response was interrupted. Continue…". On the maintainer's DB all 27 were subagent results (`description: "Subagent result"`, `metadata{source: "subagent", childID, agent, state}`) and plan reminders. The canonical view projects `synthetic` as `metadata.source ?? "opencode"`; only an `"opencode"` synthetic **directly after a failed step** counts as an automatic resend.
- **What is persisted after a failure**: `idle` with `outcome: "failed"` and the same `error` (15 rows), opencode's "continue" `synthetic` turn when it resends, the user's own resends as `user` turns, and the next successful step.
- **Measured resend cost**: on the maintainer's DB, the step that recovered after three rate limits (and 10 automatic resends) sent 46,407 input tokens; one after a 401 sent 104,325; both with 0 cache reads. That usage is an upper bound on what a failure cost, not waste: the original call would have paid most of the same context.
- **What a failure adds to a session** (`sessionFailureReport`, shown in replay and on `/audit`). Because failed calls normally record no usage, subtracting them from a session's total changes nothing; the overhead is measured as three separate figures, never one "waste" number: (1) usage recorded on the failed calls themselves — certain, normally 0; (2) **cache lost** — `max(0, before.cacheRead − recovery.cacheRead)`, capped at the recovery's input, where `before` is the last successful step before the failure, computed only when both steps used the same model and priced as input rate − cache-read rate; (3) **redone calls** — tool calls from the recovery until the user's next real message whose `callSignature` (loop detection's tool + input hash) matches a call made in the failed turn. Measured on the maintainer's DB: 40,704 tokens of cache lost in one incident, 1 redone `shell` call; the other recovery had no prior step, so nothing was lost.

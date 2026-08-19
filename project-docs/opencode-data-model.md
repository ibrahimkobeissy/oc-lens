# opencode data model — verified reference

**This is the evidence base for every data-layer ticket in [backlog.md](./backlog.md).** Everything marked ✅ VERIFIED was read directly out of the live opencode database on the maintainer's machine on 2026-08-01. Everything marked ⚠️ UNVERIFIED is claimed by upstream docs or by the vault synthesis note but was **not** observable in the sample available. Do not code against an ⚠️ shape without running the probe step named in its ticket first.

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
- **`session.model`'s `variant` is absent for at least one real custom (non-catalog) provider.** A real row reported live was `{ "id": "ClovisLLM", "providerID": "litellm" }` — a self-hosted LiteLLM proxy model with no `variant` key at all. The decoder (`lib/decode/session.ts`) previously required `id`/`providerID`/`variant` all present, so this row was rejected as `malformed-session-model`. It now only requires `id`/`providerID`; `variant` decodes to `null` when the key is absent. `types/oc.ts`'s `OcSessionModel.variant` is now `string | null`. No renderer change was needed — `app/sessions/[id]/page.tsx`'s model badge already used a truthy check (`session.model.variant ? …` ) that treats `null` the same as the old empty string never actually observed.

Neither finding changes what counts as genuinely malformed: a `tail_start_id` or `variant` present with the wrong JSON type is still flagged. Only "key absent entirely" moved from malformed to a legitimate optional-field shape.

## 6. Security — non-negotiable

- **The DB is opened read-only. Always.** `new DatabaseSync(path, { readOnly: true })` (or the `?mode=ro` URI equivalent). There is exactly one SQLite file holding the user's entire agent history; the blast radius of a write bug is total.
- **Hard denylist, enforced in the connection layer, not by convention:** the tables `account`, `account_state`, `control_account`, `credential` must never be selected from, and `~/.local/share/opencode/auth.json` / `account.json` must never be read. OCL-017 makes this a test, not a comment.
- **Config rendering must redact.** `opencode.jsonc` provider blocks hold API keys. The settings reader (OCL-110) redacts by allowlist — never by blocklist regex — before anything leaves the server.
- **oc-lens's only write path** is its own config file at `~/.config/oc-lens/config.json` (user-entered model prices). The path is a constant; no user input ever reaches a filesystem path.

## 7. HTTP API (optional, live features only)

`opencode serve` exposes `GET /session`, `/session/:id/message`, `/session/:id/todo`, `/session/:id/diff`, `/project`, `/config`, `/agent`, `/mcp`, `/lsp`, an SSE stream at `/global/event`, and OpenAPI at `/doc`. **oc-lens does not require it.** It is used only by OCL-112 (live MCP/LSP/agent health), which must degrade to a clean "opencode server not running" state rather than erroring.

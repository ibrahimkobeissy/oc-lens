# oc-lens

A local-only, **read-only** analytics dashboard for opencode: reads `~/.local/share/opencode/opencode.db` and shows sessions, tokens, cost, tools, errors, agents, projects, activity, and conversation replay. The analytics layer is the product — `opencode web` already exists and is not what this is.

**Stack:** Next.js 16 App Router · React 19 · TypeScript strict · Tailwind 4 · shadcn/ui · Recharts · SWR · Vitest. Node 22.23.4+, 24.22.1+, or 26.12.1+ required (the Node2Shell fix, CVE-2026-111497).

## Status

oc-lens is published to npm; `npx oc-lens` runs it. It's verified against the database schemas produced by opencode 1.17.7 (`session`/`message`/`part`) and opencode 2.1.4 (`session_v2`/`session_message`), including 1.x databases upgraded to 2.x that hold both; a schema guard refuses to render against an incompatible schema rather than show wrong numbers. The commands below are real — run them.

**What matters most:** spotting where the model looped for nothing or burned tokens on failures — loop detection (`/loops`, `lib/loops/`, `lib/queries/loops.ts`, `lib/diagnostics/`) and the provider audit (`/audit`, `lib/queries/failures.ts`, `lib/queries/slow-starts.ts`). Rank new work against that.

## Commands

| Command | Does |
| --- | --- |
| `pnpm typecheck` | TS strict; no `any` outside a documented decoder boundary |
| `pnpm lint` | lint |
| `pnpm test` | Vitest, against the fixture DBs — never the developer's real DB |
| `pnpm fixture` / `pnpm fixture:demo` | Build the synthetic test fixture / the 2.x demo database used for screenshots |

## Read before writing code

These are binding, not background. Do not infer from memory what they specify.

- `project-docs/opencode-data-model.md` — **the only source of truth for opencode's data shapes.** Never infer a shape. A shape marked ⚠️ UNVERIFIED must be probed (values-free) before code depends on it; record the result in this doc in the same change.
- `CONTRIBUTING.md` — the definition of done every change must meet.

## Architecture

Repo layout:

```
app/          # Next.js App Router: pages + API routes
components/   # ui/ (shadcn) · layout/ · charts/ · <feature>/
lib/          # db/ · decode/ · queries/ · pricing/ · tools/ · loops/ · diagnostics/
types/oc.ts   # domain types + API contracts — stable; change deliberately
test/fixtures/# generated fixture DBs (gitignored; built by pnpm fixture)
bin/          # CLI entrypoint
.reference/   # read-only upstream cc-lens checkout, gitignored
```

Flow: a page calls an API route → a module in `lib/queries/` runs SQL aggregation against the read-only SQLite connection from `lib/db/` → `lib/decode/` unpacks JSON payload columns → cost is applied from `lib/pricing/` using user-entered prices.

## Gotchas

- **Read-only is absolute (D2).** The DB is opened `readOnly: true`; no route may write to opencode's database, config, or session files. One SQLite file holds the user's entire agent history, so a write bug is unrecoverable. The single sanctioned write is oc-lens's own `~/.config/oc-lens/config.json` for model prices.
- **`cost` columns from opencode are not the cost.** The maintainer's provider reports `cost: 0`. All cost figures come from user-entered $/1M-token prices (D3); stored `cost` is shown only as a labelled comparison.
- **`.reference/cc-lens` is for information architecture, component structure and interaction design — never for data access.** Its entire reader layer (`lib/claude-reader.ts`, `lib/decode.ts`) is meaningless for opencode. It is MIT-licensed: re-implement against our own types, never copy files verbatim.
- **`types/oc.ts` is the API contract.** Every route and page shares it; change it deliberately, in its own commit, never as a drive-by. Fields kept only for compatibility (e.g. `AgentsResponse.switches`, served empty) say so in a comment.
- **`node:sqlite` (`DatabaseSync`), not `better-sqlite3`** (D7) — zero native deps so `npx oc-lens` needs no prebuild matrix. It is a younger API; OCL-011 isolates it so a swap is a one-file change.
- **Three data states must render**: empty, sparse, populated. No `NaN`, no `Infinity`, no `$0.00` where the honest answer is "not priced". Unknown enum values get an explicit `unknown` bucket, never a silent `0`.
- **A failed call is not the same as an errored tool.** opencode reports `state.status: "completed"` for a shell command that exited non-zero — the tool ran, the command failed. `state.metadata.exit` is the real signal (data-model §5, verified 2026-08-20) and `lib/loops/outcome.ts` is the only place that decides it. Never infer failure from output text.
- **Loop detection has a specific, defended definition.** A "loop" is the *same* call repeated — matched on tool name plus a hash of `part.data.state.input`, never on the tool name alone. Reading five different files is ordinary work and must never be reported. The threshold starts at **3**: on real data every 2-run pair had 52–77 unrelated calls between its runs. A re-read of a file modified in between is edit-then-verify, not repetition, and `splitOnMutations` exists to keep it that way. Marking in replay is strictly **per call** — banding a whole turn was tried and it made ordinary turns look like loops.
- **The fixture's empty tool inputs are a fixture artifact, not opencode behaviour.** The generator writes `input: {}` for `glob`/`grep`/`task`/`todowrite`/`question` and the MCP tools; real opencode records inputs for *every* tool (data-model §5, verified 2026-08-20). Never conclude "opencode does not record X" from the fixture alone.
- **`repeatedTurnCost` is an upper bound, not savings.** opencode records cost per message, never per tool call, so it is split across a message's calls and is dominated by context tokens the turn would have paid anyway. Never label it "wasted spend".
- **Failures hide inside steps.** A finally-failed call is an assistant step with `error`; retries opencode made *inside* a step are only visible through an optional `retry{attempt, …}` field, and a step can retry and then succeed with no `error` at all (data-model §8.7). Most `synthetic` turns are plan reminders and subagent results, not resends. A failure's overhead is never "session total minus errors" and never the recovery's whole usage: it is usage recorded on failed calls, **cache lost** on the replay, **redone calls**, and — labelled as an estimate — requests the provider accepted (HTTP 2xx) with no recorded usage.
- **Anything leaving the machine must be shape-only.** `GET /api/diagnostics/loops` reports tool names, input *key* names, JSON types, and counts — never values, since tool inputs hold shell command lines and file contents. Its redaction is asserted by test, not by convention.
- **opencode 2.x is read through TEMP views, not by rewriting queries.** `lib/db/canonical.ts` installs connection-private views named `session`/`message`/`part`/`todo` that shadow the 1.x tables and project `session_v2` + `session_message` into the 1.x row shapes (data-model §8). Query modules keep reading the 1.x names; a mixed database is deduplicated there, once. Lifecycle records (`idle`, `system`, …) are deliberately *not* messages — replay reads them from `oc_session_event`.
- **Never read `account`, `credential`, `auth.json`, or `account.json`** — no value from them may appear in any response (data-model §6). This is stricter than, and independent of, the guardrails below.

## Security Guardrails

Agents operate **inside the project directory**. Treat anything outside it as
off-limits unless the user explicitly asks. The paths below are hard
prohibitions: never `Read`, `Edit`, `Write`, `cat`/`less`/`grep`/copy, or
otherwise access them, and **never echo their contents** into a file, a note, a
web request, or the chat (no exfiltration).

- **Credential & key stores:** `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gcloud`,
  `~/.azure`, `~/.kube`, `~/.oci`, `~/.docker/config.json`, `~/.netrc`,
  `~/.git-credentials`, `~/.config/gh`, `~/.npmrc`, `~/.pypirc`.
- **Agent tokens:** `~/.config/anthropic`, `~/.claude/.credentials.json`,
  `~/.claude.json`, `~/.codex`, `~/.gemini`.
- **Secret files anywhere:** `.env` / `.env.*`, `*.pem`, `*.key`, `*.p12`,
  `*.pfx`, `*.jks`, `*.keystore`, `id_rsa*`, `id_ed25519*`, `id_ecdsa*`,
  `*service-account*.json`, `*credentials*.json`, `secrets.*`, `*.secret`,
  `*.tfstate*`, `.pgpass`, `.my.cnf`, `.vault-token`.
- **Shell/DB history:** `~/.bash_history`, `~/.zsh_history`, `~/.python_history`,
  `~/.psql_history`.

**Enforcement (Claude Code):** `permissions.deny` in `.claude/settings.json`
covers the native Read/Edit/Write tools, and the `PreToolUse` hook
(`guard-sensitive-paths.py`) covers shell commands — including the `cat … `
case that path-based denies cannot stop. If a task genuinely requires touching
one of these paths, **stop and ask the user to do it manually**; do not work
around the guardrail.

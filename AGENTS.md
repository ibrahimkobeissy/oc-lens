# oc-lens

A local-only, **read-only** analytics dashboard for opencode: reads `~/.local/share/opencode/opencode.db` and shows sessions, tokens, cost, tools, errors, agents, projects, activity, and conversation replay. The analytics layer is the product — `opencode web` already exists and is not what this is.

**Planned stack** (decision D6): Next.js 16 App Router · React 19 · TypeScript strict · Tailwind 4 · shadcn/ui · Recharts · SWR · Vitest. Node ≥ 22.5 required.

## Status: v1 shipped

The v1 backlog is implemented — `app/`, `components/`, `lib/`, `bin/`, and `test/` are all populated — and oc-lens is published to npm; `npx oc-lens` runs it. It's verified against the database schema produced by opencode 1.17.7; a schema guard refuses to render against an incompatible schema rather than show wrong numbers. The commands below are real — run them.

**Post-v1 work in progress: loop detection** (`/loops`, `lib/loops/`, `lib/queries/loops.ts`, `lib/diagnostics/`). This is **not in the frozen backlog** — the maintainer stated after v1 shipped that spotting when the model loops for nothing, or loops on errors, is the main reason oc-lens exists. Rank future work against that, not against the backlog alone.

## Commands

| Command | Does |
| --- | --- |
| `pnpm typecheck` | TS strict; no `any` outside a documented decoder boundary |
| `pnpm lint` | lint |
| `pnpm test` | Vitest, against the fixture DB (OCL-013) — never the developer's real DB |

## Read before writing code

These are binding, not background. Do not infer from memory what they specify.

- `project-docs/backlog.md` — the frozen v1 backlog. **§0 is binding process**: take exactly one ticket, never start one whose `Depends on` tickets are unmerged, and treat its `Owns` file list as a lock. §5 is the global Definition of Done.
- `project-docs/opencode-data-model.md` — **the only source of truth for opencode's data shapes.** Never infer a shape. A shape marked ⚠️ UNVERIFIED has a probe step in its ticket; run the probe and update this doc in the same PR.

## Architecture

Repo layout (backlog §3), as implemented:

```
app/          # Next.js App Router: pages + API routes
components/   # ui/ (shadcn) · layout/ · charts/ · <feature>/
lib/          # db/ · decode/ · queries/ · pricing/ · tools/ · loops/ · diagnostics/
types/oc.ts   # domain types + API contracts — FROZEN (OCL-010)
test/fixtures/# generated fixture DBs (OCL-013)
bin/          # CLI entrypoint (OCL-130)
.reference/   # read-only upstream cc-lens checkout, gitignored
```

Flow: a page calls an API route → a module in `lib/queries/` runs SQL aggregation against the read-only SQLite connection from `lib/db/` → `lib/decode/` unpacks JSON payload columns → cost is applied from `lib/pricing/` using user-entered prices.

## Gotchas

- **Read-only is absolute (D2).** The DB is opened `readOnly: true`; no route may write to opencode's database, config, or session files. One SQLite file holds the user's entire agent history, so a write bug is unrecoverable. The single sanctioned write is oc-lens's own `~/.config/oc-lens/config.json` for model prices.
- **`cost` columns from opencode are not the cost.** The maintainer's provider reports `cost: 0`. All cost figures come from user-entered $/1M-token prices (D3); stored `cost` is shown only as a labelled comparison.
- **`.reference/cc-lens` is for information architecture, component structure and interaction design — never for data access.** Its entire reader layer (`lib/claude-reader.ts`, `lib/decode.ts`) is meaningless for opencode. It is MIT-licensed: re-implement against our own types, never copy files verbatim.
- **`types/oc.ts` is frozen** (OCL-010). Changing it is its own ticket, not a drive-by.
- **`node:sqlite` (`DatabaseSync`), not `better-sqlite3`** (D7) — zero native deps so `npx oc-lens` needs no prebuild matrix. It is a younger API; OCL-011 isolates it so a swap is a one-file change.
- **Three data states must render**: empty, sparse, populated. No `NaN`, no `Infinity`, no `$0.00` where the honest answer is "not priced". Unknown enum values get an explicit `unknown` bucket, never a silent `0`.
- **A failed call is not the same as an errored tool.** opencode reports `state.status: "completed"` for a shell command that exited non-zero — the tool ran, the command failed. `state.metadata.exit` is the real signal (data-model §5, verified 2026-08-20) and `lib/loops/outcome.ts` is the only place that decides it. Never infer failure from output text.
- **Loop detection has a specific, defended definition.** A "loop" is the *same* call repeated — matched on tool name plus a hash of `part.data.state.input`, never on the tool name alone. Reading five different files is ordinary work and must never be reported. The threshold starts at **3**: on real data every 2-run pair had 52–77 unrelated calls between its runs. A re-read of a file modified in between is edit-then-verify, not repetition, and `splitOnMutations` exists to keep it that way. Marking in replay is strictly **per call** — banding a whole turn was tried and it made ordinary turns look like loops.
- **The fixture's empty tool inputs are a fixture artifact, not opencode behaviour.** The generator writes `input: {}` for `glob`/`grep`/`task`/`todowrite`/`question` and the MCP tools; real opencode records inputs for *every* tool (data-model §5, verified 2026-08-20). Never conclude "opencode does not record X" from the fixture alone.
- **`repeatedTurnCost` is an upper bound, not savings.** opencode records cost per message, never per tool call, so it is split across a message's calls and is dominated by context tokens the turn would have paid anyway. Never label it "wasted spend".
- **Anything leaving the machine must be shape-only.** `GET /api/diagnostics/loops` reports tool names, input *key* names, JSON types, and counts — never values, since tool inputs hold shell command lines and file contents. Its redaction is asserted by test, not by convention.
- **Never read `account`, `credential`, `auth.json`, or `account.json`** — no value from them may appear in any response (data-model §6). This is stricter than, and independent of, the guardrails below.

## Report every milestone back to the vault (mandatory)

The build runs here, but the **thinking and the record of it live in the second brain** at `/home/ibrahim/Documents/second-brain`. That vault is where this project was designed and where its history is kept. A milestone that is not written back is lost — nobody is reading this repo's git log from over there.

**This is an explicit, user-sanctioned exception to the "stay inside the project directory" rule in the section below.** Writing to the two vault files named here is authorized. Nothing else outside this repo is.

**What counts as a milestone** — do not report per-ticket noise:

- A backlog **wave** completed (not a single ticket).
- A **locked decision (D1–D7) changed, or a new ruling made** that contradicts the backlog.
- A **probe run that updates `project-docs/opencode-data-model.md`** — especially anything that resolves the ⚠️ UNVERIFIED shapes, since the vault's design notes rest on them.
- **Scope moving**: something in v1 dropped, or a non-goal taken on.
- A blocker that stops the build.

**Where to write** — these two files only:

| File | What to do |
| --- | --- |
| `vault/02-personal/areas/oc-lens/oc-lens.md` | append one dated line under `## 📈 Log & Progress` |
| `vault/02-personal/areas/oc-lens/todo-kanban.md` | move the card between the `## Todo` / `## In Progress` / `## Done` swimlanes |

**House style for anything written into the vault** (its conventions, not this repo's):

- **Never hard-wrap prose.** One paragraph = one continuous line, no manual newlines mid-paragraph. Obsidian reflows it; hard wraps freeze the text at ~80 columns.
- **Always leave a blank line before a table**, or it renders as raw `| … |`.
- Link other notes with `[[wikilinks]]`; use absolute dates (`2026-08-01`), never "yesterday".
- Write the honest outcome, including corrections to earlier claims. The existing log already contains a `**Correction to the recon note:**` entry — that is the expected standard, not an exception.

**Hard rules:**

- **Never run git in the vault** — not `add`, not `commit`, not `push`. Read-only git is fine. The user stages and commits there manually, always.
- **Never copy source code into the vault.** It is a whiteboard for thinking, not a mirror of this repo. Link to paths here instead.
- Touch **only** the two files above. Do not create notes, edit other Areas, or reorganize anything.

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

# oc-lens

A local-only, **read-only** analytics dashboard for opencode: reads `~/.local/share/opencode/opencode.db` and shows sessions, tokens, cost, tools, errors, agents, projects, activity, and conversation replay. The analytics layer is the product — `opencode web` already exists and is not what this is.

**Planned stack** (decision D6): Next.js 16 App Router · React 19 · TypeScript strict · Tailwind 4 · shadcn/ui · Recharts · SWR · Vitest. Node ≥ 22.5 required.

## Status: pre-implementation

**No application code exists yet.** The repo currently holds only `project-docs/` and the gitignored `.reference/` checkout. Tooling is scaffolded by tickets OCL-001/002/003 — until those land, the commands below are the *contract*, not something you can run. Do not report them as passing before `package.json` exists.

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

Target layout (backlog §3) — most of it does not exist yet:

```
app/          # Next.js App Router: pages + API routes
components/   # ui/ (shadcn) · layout/ · charts/ · <feature>/
lib/          # db/ · decode/ · queries/ · pricing/ · tools/
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

# Security

oc-lens is a local-only, read-only analytics dashboard for [opencode](https://github.com/sst/opencode). These guarantees are enforced in code and tested — see `test/security/` and `lib/db/__tests__/`.

## Read-only against opencode, always

oc-lens's connection to opencode's SQLite database (`~/.local/share/opencode/opencode.db`) is opened with `DatabaseSync(path, { readOnly: true })` (`lib/db/connection.ts`). No route, query module, or page may write to opencode's database, config, or session files. One SQLite file holds the user's entire agent history — a write bug there is unrecoverable, so this is enforced at the connection layer, not left to convention.

Tested in `lib/db/__tests__/connection.test.ts` (a `CREATE TABLE` fails) and `test/security/read-only.test.ts` (`INSERT`, `UPDATE`, `DELETE`, `DROP`, and `PRAGMA journal_mode=` all fail).

## Denylisted tables

The tables `account`, `account_state`, `control_account`, and `credential` hold `access_token`, `refresh_token`, and credential `value` columns. They must never be selected from. `lib/db/connection.ts`'s `query()` helper rejects any SQL naming one of them before it ever reaches SQLite — the only sanctioned way to run a query against the opencode connection.

Tested per-table in `lib/db/__tests__/connection.test.ts`. `test/security/no-secrets-static.test.ts` additionally scans `app/`, `lib/`, and `components/` for the literal strings `auth.json`, `account.json`, `access_token`, `refresh_token`, and the four table names above — failing if any appears outside `lib/db/connection.ts`'s denylist constant.

`~/.local/share/opencode/auth.json` and `account.json` must never be opened by any code path.

## The single sanctioned write path

oc-lens's own config file at `~/.config/oc-lens/config.json` — user-entered $/1M-token model prices (D3) — is the **only** file oc-lens ever writes. The path is a module constant; no API surface accepts a caller-supplied filesystem path. Reads and writes go through `PUT /api/pricing` (OCL-016), which is the only route in the product allowed to export a mutating HTTP method.

`test/security/route-handlers.test.ts` walks every `app/api/**/route.ts` and fails if any file exports `POST`, `PATCH`, or `DELETE`, or exports `PUT` from anywhere other than `app/api/pricing/route.ts`.

## Config redaction

`opencode.jsonc` provider blocks can hold API keys. The settings reader (OCL-110) redacts by **allowlist**, not blocklist — only known-safe keys are emitted; everything else, including unrecognised keys, is replaced with `"[redacted]"`, since an unrecognised key may be a token.

## Tool inputs are hashed, never surfaced

Loop detection compares tool calls by a signature of `part.data.state.input`. That input holds shell command lines and whole file contents, so `lib/loops/signature.ts` emits only `tool:sha256(...)` — no code path returns raw input, and no incident carries it.

`GET /api/diagnostics/loops` is designed to be copied off the machine that produced it, so it is shape-only: tool names, input **key** names, the JSON types of those keys, counts, and histograms. It carries no ids, paths, titles, commands, or file contents. `lib/diagnostics/__tests__/loop-report.test.ts` asserts the negative directly — the serialised report must not contain any planted value, any generated path or command, any skill name (those are input *values*), any row id, or any absolute path.

## Schema guard

`lib/db/schema-guard.ts` asserts the tables and columns every query module depends on before oc-lens ever renders a number from the database. On any mismatch it returns a structured `SchemaMismatch` naming exactly what differs — it never silently degrades or guesses at a shape it hasn't verified.

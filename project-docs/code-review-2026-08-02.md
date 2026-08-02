# Code review — 2026-08-02

Full review of the oc-lens codebase at commit `19b07ff`.

**Baseline:** `pnpm typecheck` ✓ · `pnpm lint` ✓ · 501/501 tests pass.

**Scope:** entire backend (`lib/db`, `lib/decode`, `lib/queries`, `lib/pricing`, `lib/config`, `lib/http`, `lib/format`), all 18 API routes, the CLI (`bin/`), the security tests, and a line-by-line pass of every component/page/hook in `components/`, `app/`, `hooks/`.

**Verdict: unusually clean.** No high-severity, no data-leak, no SQLi, no XSS, no read-only violations found. The deny-list, redaction allowlist, and decoder-boundary discipline are genuinely well done. What's below is mostly robustness, performance-at-scale, and test-hardening.

---

## Medium

### M1 — `storedCostComparison` is all-time on `/api/stats` but ranged on `/api/costs`

`lib/pricing/breakdown.ts:213` computes it with no range filter, and `app/api/stats/route.ts:52` uses it directly — so a "7d" overview shows the **all-time** provider-reported cost. `app/api/costs/route.ts:93` deliberately re-scopes it to the range ("must compare like with like"). One of these is wrong; the overview contradicts the costs page for the same range.

### M2 — `listSessions` runs a full-DB `costBreakdown` on every request

`lib/queries/sessions.ts:151-153`: whenever `pricing` is passed (always, from the sessions/session-detail routes), a complete pass over **all** sessions + **all** messages (JSON-parse each) runs — even for a single-session lookup or a 25-row page. Combined with `useOc`'s 30s default polling (`lib/swr.ts:14-19`), every sessions-page poll is O(whole DB). Consider scoping cost to the matched session ids, or only computing it for `sort=cost`/the overview.

### M3 — `agentUsage` is quadratic

`lib/queries/agents.ts:45`: `sessions.find(...)` inside the per-message loop is O(sessions × messages). Build a `Map(id → session)` once.

### M4 — tool-group collapse is inert while a `?part=` target is active

`components/sessions/replay/tool-group.tsx:43-44`: `expanded = userExpanded || targetExpanded`, and `targetExpanded` stays true while the URL still carries `?part=<id>`, so "Collapse calls" does nothing until the URL is cleared. Track the user's explicit choice (or clear `?part` on collapse).

### M5 — security tests have blind spots

- `test/security/no-secrets-static.test.ts:6` only scans `["app","lib","components"]`. It misses `types/`, `bin/`, `hooks/`, `design-system/` — and `types/oc.ts:649` already contains `credential-free`, which the `\bcredential\b` regex would flag if scanned. Extend `SCAN_DIRS` and reword that comment.
- `test/security/route-handlers.test.ts:17`: the write-method regex only matches `export function|const NAME`; `export { POST }` or `export { POST as handler }` would evade the "GET/HEAD/OPTIONS only" guard. Add a re-export pattern.

### M6 — unbounded `IN` clause in subagent-tree routes

`app/api/sessions/tree/route.ts:46-47` (and the `[id]/tree` twin) build one `IN (?,…)` over every subagent id — beyond SQLite's ~32k variable limit this throws → 500. The codebase already chunked at 800 elsewhere (`lib/queries/sessions.ts:101`); reuse that pattern.

---

## Low

- **L1** `hooks/use-oc-files.ts` doesn't exist — only its type test (`hooks/use-oc-files.test.ts`), which nothing imports. Dropped ticket or leftover stub.
- **L2** `lib/format.ts:47` `formatCost` would render `$NaN`/`$Infinity` for a `priced:true` non-finite amount. Unreachable today (config validation + token decode guarantee finiteness) but this is the single load-bearing display function; add a `Number.isFinite` guard to enforce the no-NaN rule at the boundary.
- **L3** `components/ui/progress.tsx:25` `translateX(-${100 - (value || 0)}%)` is unclamped — latent overflow/`NaN%` if a future caller passes >100.
- **L4** `components/costs/cost-summary.tsx:6` only guards `value === 0`; a negative/NaN `storedCostComparison` renders `-$x`/`$NaN`.
- **L5** `lib/config/read.ts:147` concatenates DB-controlled `project.worktree` values into filesystem paths the server reads. Mitigated (fixed filenames, `lstatSync` no-symlink check, redacted output) but worth rejecting non-absolute worktrees / `..` segments.
- **L6** `bin/cli-lib.js:141-142` readiness poll treats any `<500` status as ready and polls `/` — a broken app that 404s still prints `Ready:`. Poll `/api/health` and require 200.
- **L7** `bin/cli-lib.js:226-229` SIGTERMs a failed child but never awaits its exit (lingering process on the port); `selectPort`→spawn is also a TOCTOU race.
- **L8** `lib/routes.test.ts:24` asserts `enabled: true` against a hardcoded list without checking the page file exists — deleting a page still passes.
- **L9** `components/agents/agent-activity-chart.tsx:13-21` keys the series map by raw agent name; an agent named `toString`/`constructor` reads inherited keys → NaN. Cosmetic edge.

---

## Confirmed solid (worth protecting, not changing)

- **Read-only enforcement is real and tested**: every write statement genuinely throws on the `readOnly` connection (`test/security/read-only.test.ts`); all SQL flows through the denylisted `query()`; no `account`/`credential` values can reach any response.
- **XSS surface closed**: `react-markdown` uses `skipHtml` + http(s)-only `safeHref`; the only `dangerouslySetInnerHTML` is a trusted static script in the theme provider.
- **Decoder discipline is exemplary** — unknown enum values bucket to `unknown`, nothing silently zeroes; `$0.00`-for-unpriced and NaN/Infinity invariants hold across components.
- **Cursor pagination, cursor-signature validation, and query-param validation** on `/api/sessions` are thorough.

---

## Summary

| Severity | Count |
| --- | --- |
| High | 0 |
| Medium | 6 |
| Low | 9 |

Suggested order of work: M1 (visible data inconsistency), M5/M6 (test + robustness), M2/M3 (scale), M4 (UX bug), then the lows.

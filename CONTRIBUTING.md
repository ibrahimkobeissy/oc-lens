# Contributing to oc-lens

Thanks for helping. oc-lens reads a database that holds someone's complete local agent history, so a few rules are non-negotiable. Everything else is ordinary good practice.

## The rules

1. **Read-only, always.** The opencode database is opened with `readOnly: true`. No route may write to opencode's database, configuration, or session files. The single sanctioned write is oc-lens's own pricing file, `~/.config/oc-lens/config.json`, through `PUT /api/pricing`.
2. **Never infer a data shape.** [`project-docs/opencode-data-model.md`](project-docs/opencode-data-model.md) is the source of truth for what opencode stores. If you need a shape it marks ⚠️ UNVERIFIED, or one it does not cover, probe a real database **values-free** (key paths, JSON types, counts, enum-like labels — never text, inputs, paths, or ids) and record the result in that document in the same change.
3. **Tests use fixtures, never your own history.** Use `test/fixtures/populated.db`, `test/fixtures/empty.db`, the 2.x fixtures in `test/fixtures/v2-fixture.ts`, or a purpose-built temporary database.
4. **Be honest in the UI.** Empty, sparse, and populated data must all render. No `NaN`, no `Infinity`, no `$0.00` where the truth is "not priced"; unknown values get an explicit `unknown` bucket. An estimate is labelled as one.
5. **Credentials stay untouched.** The `account`, `credential`, and related tables, and opencode's `auth.json`, are never read; no value from them may appear in any response.

## Set up

Node.js 22.23.4+, 24.22.1+, or 26.12.1+ (the Node2Shell fix, CVE-2026-111497) and pnpm are required.

```sh
pnpm install
pnpm fixture          # synthetic opencode 1.x history, ~120 sessions
pnpm fixture:demo     # synthetic opencode 2.x history with failures, retries, and slow starts
OC_LENS_DB="$PWD/test/fixtures/demo.db" pnpm dev
```

## Before you open a pull request

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

All four must pass. Then check:

- The opencode connection is still read-only, and nothing you added writes outside the pricing file.
- New behaviour has tests, including the empty state.
- `types/oc.ts` is the shared API contract: change it deliberately and say why in the PR.
- Anything that may leave the user's machine (an export, a diagnostics payload) is shape-only — never prompt text, tool inputs, file contents, or paths.

Small, focused pull requests are reviewed fastest. For anything larger, open an issue first so we can agree on the approach.

## Design reference

The information architecture was inspired by [cc-lens](https://github.com/Arindam200/cc-lens) (MIT). Its UX may inform ours; its code may not be copied, and its Claude Code data layer has nothing to do with opencode's.

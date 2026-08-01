# Contributing to oc-lens

oc-lens protects a database containing a user's complete local agent history. Contributions must preserve the read-only boundary and the evidence rules below.

## Before taking a ticket

Read these binding documents in full:

1. [`project-docs/backlog.md`](project-docs/backlog.md), especially §0 (process), the ticket's `Depends on` and `Owns` fields, and §5 (global Definition of Done).
2. [`project-docs/opencode-data-model.md`](project-docs/opencode-data-model.md), the only source of truth for opencode data shapes.
3. [`AGENTS.md`](AGENTS.md) for repository and security constraints.

Take **exactly one ticket**. Do not start it until every dependency is merged. Treat the ticket's `Owns` list as an exclusive file lock: no drive-by edits, including to frozen `types/oc.ts`. If a needed change falls outside the lock, stop and coordinate a separate ticket.

A shape marked ⚠️ UNVERIFIED requires the probe named by its ticket. Run that probe and update the data-model document in the same change; never infer a database or JSON shape from fixtures, cc-lens, or memory.

## Development

Node.js 22.5 or newer and pnpm are required.

```sh
pnpm install
pnpm fixture
OC_LENS_DB="$PWD/test/fixtures/populated.db" pnpm dev
```

`.reference/cc-lens` may inform information architecture, component structure, and interaction design only. Do not use its Claude Code reader/decode layer for opencode, and do not copy its source verbatim.

## Verification

Run the ticket's focused tests while developing, then complete the repository verification required by backlog §5:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Tests must use `test/fixtures/populated.db`, `test/fixtures/empty.db`, or a purpose-built temporary fixture. **Never point tests or exploratory writes at the developer's real opencode database.** Exercise empty, sparse, and populated states where the ticket can affect them, and preserve honest unknown/unpriced states: no `NaN`, `Infinity`, or `$0.00` when the value is not priced.

Before handoff:

- Confirm the opencode connection remains read-only and no route writes to opencode's database, configuration, or session files.
- Confirm credential-bearing tables and secret files are never read or exposed.
- Check the ticket's acceptance criteria individually.
- Review the scoped diff for unrelated changes and run `git diff --check` on owned files.
- Report commands and outcomes honestly; do not claim a contract command passed if it was not run.

The single sanctioned product write is the user's model pricing file at `~/.config/oc-lens/config.json`, through `PUT /api/pricing` only.

## Milestones

Follow `AGENTS.md` for milestone reporting. A completed backlog wave, changed locked decision, data-model probe, scope change, or build-stopping blocker must be recorded in the two authorised second-brain files. Per-ticket noise is not a milestone, and source code must not be copied into the vault.

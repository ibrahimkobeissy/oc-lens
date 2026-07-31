---
name: security-guardrails
description: >-
  Install portable, project-agnostic security guardrails that stop AI coding
  agents from reading or exfiltrating credentials and secrets (SSH/AWS/GCP keys,
  .env files, *.pem/*.key, tokens, shell history, terraform state). Copy the
  folder into any project's .claude/skills/ and run it to wire up a deny list
  PLUS a PreToolUse hook that blocks shell reads (cat/less/grep/cp) the deny
  list misses. Use whenever the user wants to harden a repo, protect secrets
  from agents, set up agent security/guardrails, prevent the agent from reading
  .env / .ssh / credentials, or asks to "lock down" what an agent can touch.
---

# Security Guardrails

Portable, copy-paste protection that stops an agent (Claude Code, and via the
prose rules, Codex and other agents too) from reading or leaking credential and
secret files. **Drop this folder into any project's `.claude/skills/`, run the
installer once, and the project is hardened.**

## Why three layers

No single mechanism is airtight, so this skill stacks three that cover each
other's blind spots:

1. **`permissions.deny` rules** in `.claude/settings.json` — block the native
   `Read`/`Edit`/`Write` tools. Documented, visible in the permissions UI, work
   even if hooks are disabled. **Blind spot:** they don't see shell commands —
   `cat ~/.ssh/id_rsa` sails right through.
2. **A `PreToolUse` hook** (`scripts/guard-sensitive-paths.py`) — inspects each
   `Bash` command by the *path it names*, so it catches every reader (`cat`,
   `less`, `head`, `xxd`, `cp`, `base64`, `vim`, …) regardless of the binary.
   This closes the gap layer 1 leaves open, and also re-checks the native tools.
3. **Instructional rules** (`references/instructional-rules.md`) — prose to paste
   into `CLAUDE.md`/`AGENTS.md` so agents whose runtime ignores Claude
   `settings.json` hooks (e.g. Codex or other tools) are still bound by the same policy.

**Be honest about the limit:** the hook is a strong heuristic, not a sandbox. A
determined agent could obfuscate a path (variables, base64, `eval`). The point is
defense in depth — raise the bar high and stop every obvious case. Say this to
the user; don't oversell it as airtight.

## Install (do this when invoked)

1. **Confirm location.** The folder must sit at
   `<project>/.claude/skills/security-guardrails/`. If the user copied it
   elsewhere, move it there first.
2. **Run the installer** from the project root:
   ```
   python3 .claude/skills/security-guardrails/scripts/install.py
   ```
   It merges the deny rules and registers the hook in `.claude/settings.json`,
   creating the file if needed. It is **idempotent** — re-running only adds
   what's missing, and never disturbs existing settings, permissions, or hooks.
3. **Verify** the hook works end-to-end:
   ```
   python3 .claude/skills/security-guardrails/scripts/selftest.py
   ```
   All cases should pass. This runs real block/allow events through the hook.
4. **Add the prose rules.** Open `references/instructional-rules.md` and paste
   its `## Security Guardrails` section into the project's `CLAUDE.md` (and
   `AGENTS.md` if it is not a symlink to the same file). Adapt only the wording
   to match the file's style — keep the path list and the "ask the user to do it
   manually" rule intact.
5. **Tell the user to restart the session.** Hooks are loaded at session start,
   so the `PreToolUse` hook only takes effect in a fresh Claude Code session.

Report exactly what changed (the installer prints a summary) and what's still
required of the user (the restart, and pasting the prose if you couldn't).

## What's protected

Credential & key stores (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gcloud`,
`~/.azure`, `~/.kube`, `~/.oci`, `~/.docker/config.json`, `~/.netrc`,
`~/.git-credentials`, `~/.config/gh`, `~/.npmrc`, `~/.pypirc`); agent tokens
(`~/.config/anthropic`, `~/.claude/.credentials.json`, `~/.claude.json`,
`~/.codex`, `~/.gemini`); secret files anywhere (`.env*`, `*.pem`, `*.key`, `*.p12`,
`*.pfx`, `*.jks`, `*.keystore`, `id_rsa*`/`id_ed25519*`/`id_ecdsa*`,
`*service-account*.json`, `*credentials*.json`, `secrets.*`, `*.secret`,
`*.tfstate*`, `.pgpass`, `.my.cnf`, `.vault-token`); and shell/DB history.

This skill covers **secrets only**. It does not touch git-workflow restrictions
or other project policies — keep those separate.

## Customizing

The pattern lists are the single source of truth and live at the top of two
files — keep them in sync when editing:

- `scripts/guard-sensitive-paths.py` — `SENSITIVE_DIR_SEGMENTS`,
  `SENSITIVE_PATH_SUFFIXES`, `SENSITIVE_FILE_GLOBS` (governs the hook).
- `scripts/install.py` — `DENY_RULES` (governs the native-tool deny list).

After any change, re-run `selftest.py` (add a case for whatever you changed) to
confirm you didn't introduce a false positive that blocks ordinary work.

## Troubleshooting

- **Hook not firing:** it only loads in a session started *after* install. Check
  `.claude/settings.json` has a `PreToolUse` entry referencing
  `guard-sensitive-paths.py`, then restart.
- **`settings.json` is invalid JSON:** the installer refuses to run and tells you;
  fix the JSON and re-run.
- **A legitimate task is blocked:** don't disable the hook wholesale — that's the
  guardrail working. Either ask the user to perform that one step manually, or, if
  a pattern is genuinely too broad, narrow it in both files and re-run `selftest.py`.

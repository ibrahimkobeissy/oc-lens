#!/usr/bin/env python3
"""Install the security guardrails into the current project's settings.json.

Idempotent. Merges the credential/secret ``permissions.deny`` rules and
registers the ``guard-sensitive-paths.py`` PreToolUse hook. Run it once after
copying the ``security-guardrails/`` folder into a project's ``.claude/skills/``:

    python3 .claude/skills/security-guardrails/scripts/install.py

It only adds what is missing -- existing settings, permissions, and hooks are
preserved. Re-running it is safe and reports "already present".
"""
import json
import os
import stat
import sys

# Path the registered hook command points at (resolved at hook-run time via
# $CLAUDE_PROJECT_DIR, which Claude Code sets to the project root).
HOOK_REL = ".claude/skills/security-guardrails/scripts/guard-sensitive-paths.py"
HOOK_CMD = 'python3 "$CLAUDE_PROJECT_DIR/' + HOOK_REL + '"'
HOOK_MATCHER = "Bash|Read|Edit|Write|NotebookEdit|Grep|Glob"

# Static deny rules for the native tools (defense layer 1). The hook (layer 2)
# covers the shell-command gap these cannot reach.
DENY_RULES = [
    # --- Credential & key stores ---
    "Read(~/.ssh/**)", "Edit(~/.ssh/**)", "Write(~/.ssh/**)",
    "Read(~/.aws/**)", "Edit(~/.aws/**)", "Write(~/.aws/**)",
    "Read(~/.gnupg/**)", "Write(~/.gnupg/**)",
    "Read(~/.config/gcloud/**)", "Write(~/.config/gcloud/**)",
    "Read(~/.azure/**)",
    "Read(~/.kube/**)",
    "Read(~/.oci/**)",
    "Read(~/.docker/config.json)",
    "Read(~/.netrc)",
    "Read(~/.git-credentials)",
    "Read(~/.config/gh/**)",
    "Read(~/.npmrc)",
    "Read(~/.pypirc)",
    # --- Agent tokens ---
    "Read(~/.config/anthropic/**)",
    "Read(~/.claude/.credentials.json)",
    "Read(~/.claude.json)",
    "Read(~/.codex/**)",
    "Read(~/.gemini/**)",
    # --- Shell / DB history ---
    "Read(~/.bash_history)", "Read(~/.zsh_history)",
    "Read(~/.python_history)", "Read(~/.psql_history)",
    # --- Secret files anywhere in the project tree ---
    "Read(./.env)", "Read(./.env.*)", "Read(./**/.env)", "Read(./**/.env.*)",
    "Read(./**/*.pem)", "Read(./**/*.key)", "Read(./**/*.p12)", "Read(./**/*.pfx)",
    "Read(./**/*.jks)", "Read(./**/*.keystore)",
    "Read(./**/id_rsa)", "Read(./**/id_rsa.*)",
    "Read(./**/id_ed25519)", "Read(./**/id_ed25519.*)", "Read(./**/id_ecdsa)",
    "Read(./**/*service-account*.json)", "Read(./**/*credentials*.json)",
    "Read(./**/secrets.*)", "Read(./**/*.secret)",
    "Read(./**/*.tfstate)", "Read(./**/*.tfstate.*)",
    "Read(./**/.pgpass)", "Read(./**/.my.cnf)", "Read(./**/.vault-token)",
]


def project_root():
    return os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()


def load_settings(path):
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        text = f.read().strip()
    return json.loads(text) if text else {}


def hook_already_registered(settings):
    for entry in settings.get("hooks", {}).get("PreToolUse", []):
        for h in entry.get("hooks", []):
            if "guard-sensitive-paths.py" in h.get("command", ""):
                return True
    return False


def main():
    root = project_root()
    settings_path = os.path.join(root, ".claude", "settings.json")
    os.makedirs(os.path.dirname(settings_path), exist_ok=True)

    try:
        settings = load_settings(settings_path)
    except json.JSONDecodeError as e:
        print("ERROR: %s is not valid JSON (%s). Fix it and re-run." % (settings_path, e))
        sys.exit(1)

    changes = []

    # 1) Merge deny rules (preserve order, skip duplicates).
    perms = settings.setdefault("permissions", {})
    deny = perms.setdefault("deny", [])
    added = [r for r in DENY_RULES if r not in deny]
    deny.extend(added)
    changes.append("deny rules: +%d added, %d already present"
                   % (len(added), len(DENY_RULES) - len(added)))

    # 2) Register the PreToolUse hook.
    if hook_already_registered(settings):
        changes.append("PreToolUse hook: already present")
    else:
        hooks = settings.setdefault("hooks", {})
        pre = hooks.setdefault("PreToolUse", [])
        pre.append({
            "matcher": HOOK_MATCHER,
            "hooks": [{
                "type": "command",
                "command": HOOK_CMD,
                "statusMessage": "Checking path against security guardrails",
            }],
        })
        changes.append("PreToolUse hook: registered")

    with open(settings_path, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)
        f.write("\n")

    # 3) Make the hook executable (harmless if it already is).
    hook_path = os.path.join(root, HOOK_REL)
    if os.path.exists(hook_path):
        st = os.stat(hook_path)
        os.chmod(hook_path, st.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    print("Security guardrails installed -> %s" % settings_path)
    for c in changes:
        print("  - " + c)
    print("\nRestart the Claude Code session so the new hook is loaded.")
    print("Verify with: python3 %s" % os.path.join(
        ".claude", "skills", "security-guardrails", "scripts", "selftest.py"))


if __name__ == "__main__":
    main()

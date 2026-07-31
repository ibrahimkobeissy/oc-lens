#!/usr/bin/env python3
"""PreToolUse hook: block agent access to credential / secret files.

Reads a Claude Code PreToolUse event (JSON on stdin) and DENIES any Bash
command or Read/Edit/Write/Grep call that touches a known-sensitive path.

Why this exists
---------------
Path-based ``permissions.deny`` rules stop the native Read/Edit/Write tools,
but a shell command like ``cat ~/.ssh/id_rsa`` or ``grep KEY .env`` slips past
them. This hook inspects the command string itself and matches on the *path it
names*, so it catches every reader (cat, less, head, xxd, cp, vim, base64, dd,
strings, ...) by the file, not the binary. That closes the gap the deny list
leaves open.

Honest about its limits
-----------------------
This is a heuristic, not a sandbox. A determined agent could obfuscate a path
(shell variables, base64, eval). It reliably stops the obvious cases and raises
the bar; run it alongside the deny list and the instructional rules for real
defense in depth -- no single layer is meant to stand alone.

Decision protocol: on a match, print a PreToolUse "deny" decision and exit 0.
Otherwise stay silent and exit 0 so normal permission flow continues. Any
internal error also exits 0 -- the hook must never wedge the tool pipeline.
"""
import fnmatch
import json
import os
import re
import sys

# Whole directories that are sensitive as a path segment, e.g. ~/.ssh/anything.
# These names never legitimately appear as a repo-local directory, so matching
# the bare segment anywhere in the path is safe.
SENSITIVE_DIR_SEGMENTS = {
    ".ssh", ".aws", ".gnupg", ".azure", ".kube", ".oci",
}

# Credential dirs that are sensitive ONLY in the user's home (~/.codex), because
# the same name is also a legitimate *repo-local* project-config directory:
# Codex keeps its execpolicy rules in a committed ./.codex/rules/, and Gemini
# uses ./.gemini. Blocking those by bare segment would wall the agent off from
# its own repository, so these match only when the path is home-anchored.
HOME_ANCHORED_DIR_SEGMENTS = (".codex", ".gemini")

# Multi-segment suffixes that are sensitive even though the parent dir is not
# (e.g. ~/.config holds plenty of innocuous things; ~/.config/gcloud does not).
SENSITIVE_PATH_SUFFIXES = (
    ".config/gcloud", ".config/gh", ".config/anthropic", ".config/azure",
    ".docker/config.json", ".claude/.credentials.json",
)

# Basename globs that are sensitive wherever they live.
SENSITIVE_FILE_GLOBS = (
    ".env", ".env.*",
    "*.pem", "*.key", "*.p12", "*.pfx", "*.jks", "*.keystore",
    "id_rsa", "id_rsa.*", "id_dsa", "id_ecdsa", "id_ecdsa.*",
    "id_ed25519", "id_ed25519.*",
    "*service-account*.json", "*credentials*.json",
    "secrets.*", "*.secret",
    "*.tfstate", "*.tfstate.*",
    ".netrc", ".git-credentials", ".npmrc", ".pypirc",
    ".pgpass", ".my.cnf", ".vault-token",
    ".claude.json",
    ".bash_history", ".zsh_history", ".python_history", ".psql_history",
)

# Shell metacharacters that separate one argument/token from the next.
_SPLIT_RE = re.compile(r"""[\s;|&()<>"'`,={}\[\]]+""")


def path_is_sensitive(path):
    """True if ``path`` names a protected credential / secret location."""
    p = (path or "").strip().strip("'\"")
    if not p:
        return False
    # Fold the common ways of writing $HOME into one form, drop trailing slashes.
    p = p.replace("${HOME}/", "~/").replace("$HOME/", "~/").rstrip("/")
    low = p.lower()

    # Multi-segment suffix match (pad with "/" so a bare suffix also matches).
    padded = "/" + low
    for suffix in SENSITIVE_PATH_SUFFIXES:
        if ("/" + suffix) in padded:
            return True

    # Home-anchored credential dirs (~/.codex, ~/.gemini): sensitive only in the
    # home directory, never as a repo-local .codex/.gemini project dir. ${HOME}/
    # and $HOME/ were already folded to ~/ above; also match the expanded home.
    home = os.path.expanduser("~").rstrip("/")
    for seg in HOME_ANCHORED_DIR_SEGMENTS:
        if p == "~/" + seg or p.startswith("~/" + seg + "/"):
            return True
        anchored = home + "/" + seg
        if p == anchored or p.startswith(anchored + "/"):
            return True

    segments = [s for s in p.split("/") if s]
    for seg in segments:
        if seg in SENSITIVE_DIR_SEGMENTS:
            return True

    base = segments[-1] if segments else p
    for pattern in SENSITIVE_FILE_GLOBS:
        if fnmatch.fnmatch(base, pattern):
            return True
    return False


def bash_touches_sensitive(command):
    """Return the first sensitive token in a shell command, or None."""
    for token in _SPLIT_RE.split(command or ""):
        if token and path_is_sensitive(token):
            return token
    return None


def deny(target, tool):
    reason = (
        "Blocked by security-guardrails: this {tool} call touches a protected "
        "credential/secret path ('{tgt}'). Reading, copying, or exfiltrating "
        "such files is prohibited. If you genuinely need this, ask the user to "
        "do it manually."
    ).format(tool=tool, tgt=target)
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def main():
    try:
        event = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # never wedge the pipeline on a parse error

    tool = event.get("tool_name", "")
    ti = event.get("tool_input") or {}

    if tool == "Bash":
        hit = bash_touches_sensitive(ti.get("command", ""))
        if hit:
            deny(hit, tool)
    elif tool in ("Read", "Edit", "Write", "NotebookEdit"):
        fp = ti.get("file_path") or ti.get("notebook_path") or ""
        if path_is_sensitive(fp):
            deny(fp, tool)
    elif tool in ("Grep", "Glob"):
        # Content-mode Grep over a secret file would leak it; block by target.
        for key in ("path", "glob", "pattern"):
            val = ti.get(key)
            if isinstance(val, str) and path_is_sensitive(val):
                deny(val, tool)

    sys.exit(0)


if __name__ == "__main__":
    main()

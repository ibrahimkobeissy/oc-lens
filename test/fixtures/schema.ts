/**
 * Exact DDL for the tables oc-lens reads, per project-docs/opencode-data-model.md
 * §1-§5. `workspace` and `session_input` are created but deliberately left
 * empty (0 rows) — matching the real dev machine (data-model.md §1) and
 * `lib/db/schema-guard.ts`'s expectations (it does not check these two).
 */
export const FIXTURE_SCHEMA_SQL = `
CREATE TABLE project (
  id TEXT PRIMARY KEY,
  worktree TEXT,
  vcs TEXT,
  name TEXT,
  time_created INTEGER,
  time_updated INTEGER,
  time_initialized INTEGER,
  sandboxes TEXT,
  commands TEXT
);
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  workspace_id TEXT,
  parent_id TEXT,
  slug TEXT,
  directory TEXT,
  path TEXT,
  title TEXT,
  version TEXT,
  share_url TEXT,
  summary_additions INTEGER,
  summary_deletions INTEGER,
  summary_files INTEGER,
  summary_diffs TEXT,
  metadata TEXT,
  cost REAL,
  tokens_input INTEGER,
  tokens_output INTEGER,
  tokens_reasoning INTEGER,
  tokens_cache_read INTEGER,
  tokens_cache_write INTEGER,
  revert TEXT,
  permission TEXT,
  agent TEXT,
  model TEXT,
  time_created INTEGER,
  time_updated INTEGER,
  time_compacting INTEGER,
  time_archived INTEGER
);
CREATE TABLE message (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  time_created INTEGER,
  time_updated INTEGER,
  data TEXT
);
CREATE TABLE part (
  id TEXT PRIMARY KEY,
  message_id TEXT,
  session_id TEXT,
  time_created INTEGER,
  time_updated INTEGER,
  data TEXT
);
CREATE TABLE todo (
  session_id TEXT,
  content TEXT,
  status TEXT,
  priority TEXT,
  position INTEGER,
  time_created INTEGER,
  time_updated INTEGER
);
CREATE TABLE session_message (
  type TEXT,
  seq INTEGER,
  data TEXT
);
CREATE TABLE workspace (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  branch TEXT,
  directory TEXT,
  type TEXT
);
CREATE TABLE session_input (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  data TEXT
);
`;

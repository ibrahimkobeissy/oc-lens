import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "oc-lens-test-"));
}

export function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** The full column set schema-guard.ts expects, per project-docs/opencode-data-model.md §1-§3. */
const FULL_SCHEMA_SQL = `
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
`;

/** Creates a file-backed SQLite DB at `path` with the full expected schema, WAL journal mode, and one seed row per table. */
export function createFullSchemaDb(path: string): void {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(FULL_SCHEMA_SQL);
  db.exec(`
    INSERT INTO project (id, worktree, vcs, name, time_created, time_updated, time_initialized, sandboxes, commands)
    VALUES ('global', '/', NULL, NULL, 1, 1, NULL, '[]', NULL);
    INSERT INTO session (
      id, project_id, workspace_id, parent_id, slug, directory, path, title, version, share_url,
      summary_additions, summary_deletions, summary_files, summary_diffs, metadata, cost,
      tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
      revert, permission, agent, model, time_created, time_updated, time_compacting, time_archived
    ) VALUES (
      'ses_1', 'global', NULL, NULL, 'crisp-otter', '/tmp/oc-test', 'tmp/oc-test', 'title', '1.17.7', NULL,
      0, 0, 0, NULL, NULL, 0,
      100, 10, 0, 0, 0,
      NULL, '[]', 'build', NULL, 1, 1, NULL, NULL
    );
    INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('msg_1', 'ses_1', 1, 1, '{}');
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('prt_1', 'msg_1', 'ses_1', 1, 1, '{}');
  `);
  db.close();
}

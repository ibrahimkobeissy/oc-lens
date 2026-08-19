/**
 * Tables that must never be selected from, enforced here in code — not by
 * convention (project-docs/opencode-data-model.md §6). They hold
 * `access_token`, `refresh_token`, and credential `value`.
 *
 * Shared by every module that touches the opencode connection directly
 * (`connection.ts`'s `query()`, `schema-guard.ts`'s `PRAGMA`/`sqlite_master`
 * reads) so there is exactly one place this list can drift from reality.
 */
export const DENYLISTED_TABLES = ["account", "account_state", "control_account", "credential"] as const;

export function isDenylistedTable(table: string): boolean {
  return (DENYLISTED_TABLES as readonly string[]).includes(table.toLowerCase());
}

/**
 * A deliberately simple lexical check, not a SQL parser: split on any
 * non-identifier character and compare tokens case-insensitively. This can
 * false-positive on a denylisted name appearing as a column alias or inside
 * a string literal — an acceptable trade-off for never missing a real
 * reference to one of these tables.
 */
export function findDenylistedTable(sql: string): string | null {
  const tokens = sql.toLowerCase().split(/[^a-z0-9_]+/);
  return DENYLISTED_TABLES.find((table) => tokens.includes(table)) ?? null;
}

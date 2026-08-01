import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LocateEnv {
  OC_LENS_DB?: string;
  XDG_DATA_HOME?: string;
}

export interface LocateOptions {
  env?: LocateEnv;
  homeDir?: string;
}

export type LocateResult = { found: true; path: string } | { found: false; searched: string[] };

/**
 * Resolves the opencode SQLite DB path in order: `OC_LENS_DB` env var →
 * `$XDG_DATA_HOME/opencode/opencode.db` → `~/.local/share/opencode/opencode.db`.
 * Never throws for "not found" — callers get a discriminated result instead.
 */
export function locateDb(options: LocateOptions = {}): LocateResult {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const searched: string[] = [];

  if (env.OC_LENS_DB) {
    searched.push(env.OC_LENS_DB);
    if (existsSync(env.OC_LENS_DB)) {
      return { found: true, path: env.OC_LENS_DB };
    }
  }

  if (env.XDG_DATA_HOME) {
    const xdgPath = join(env.XDG_DATA_HOME, "opencode", "opencode.db");
    searched.push(xdgPath);
    if (existsSync(xdgPath)) {
      return { found: true, path: xdgPath };
    }
  }

  const defaultPath = join(home, ".local", "share", "opencode", "opencode.db");
  searched.push(defaultPath);
  if (existsSync(defaultPath)) {
    return { found: true, path: defaultPath };
  }

  return { found: false, searched };
}

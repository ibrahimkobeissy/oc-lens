import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export interface StorageSizes {
  dbBytes: number;
  walBytes: number;
  /** null when the `log/` directory does not exist — distinct from an existing-but-empty directory (0). */
  logBytes: number | null;
  /** null when the `repos/` directory does not exist. */
  reposBytes: number | null;
  totalBytes: number;
}

function fileSize(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return 0; // never follow a symlink out of the opencode data dir
  return stat.size;
}

function directorySize(dirPath: string): number | null {
  if (!existsSync(dirPath)) return null;
  if (lstatSync(dirPath).isSymbolicLink()) return null; // the directory itself must not be a symlink out

  let total = 0;
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue; // never follow a symlink out of the opencode data dir
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile()) {
        total += statSync(entryPath).size;
      }
    }
  };
  walk(dirPath);
  return total;
}

/** Byte sizes of `opencode.db` + `-wal` + `log/` + `repos/`, given the resolved DB path. */
export function computeStorageSizes(dbPath: string): StorageSizes {
  const dataDir = dirname(dbPath);
  const dbBytes = fileSize(dbPath);
  const walBytes = fileSize(`${dbPath}-wal`);
  const logBytes = directorySize(join(dataDir, "log"));
  const reposBytes = directorySize(join(dataDir, "repos"));

  return {
    dbBytes,
    walBytes,
    logBytes,
    reposBytes,
    totalBytes: dbBytes + walBytes + (logBytes ?? 0) + (reposBytes ?? 0),
  };
}

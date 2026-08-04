import { NextResponse } from "next/server";
import { readOpencodeConfig } from "@/lib/config/read";
import { redactConfig } from "@/lib/config/redact";
import { getConnection, query } from "@/lib/db/connection";
import { locateDb } from "@/lib/db/locate";
import { schemaVersion } from "@/lib/db/schema-guard";
import { computeStorageSizes } from "@/lib/db/storage";
import type { OcResponse, SettingsResponse, SettingsRouteResponse, StorageBreakdown } from "@/types/oc";

export const dynamic = "force-dynamic";

interface WorktreeRow {
  worktree: string;
}

interface VersionRow {
  version: string;
}

const EMPTY_STORAGE: StorageBreakdown = {
  dbBytes: 0,
  walBytes: 0,
  logBytes: null,
  reposBytes: null,
  totalBytes: 0,
};

function envelope<T>(data: T): OcResponse<T> {
  return { data, meta: { generatedAt: Date.now(), schemaVersion, warnings: [] } };
}

export async function GET(): Promise<NextResponse<SettingsRouteResponse>> {
  const located = locateDb();
  const connected = getConnection();
  if (!connected.ok && connected.reason === "schema-mismatch") {
    return NextResponse.json(
      { error: { code: "schema_mismatch", message: `The opencode database schema is not supported by ${schemaVersion}.` } },
      { status: 409 },
    );
  }
  let projectWorktrees: string[] = [];
  let opencodeVersion: string | null = null;

  if (connected.ok) {
    projectWorktrees = query<WorktreeRow>(
      connected.db,
      "SELECT worktree FROM project WHERE worktree IS NOT NULL AND worktree <> '' ORDER BY worktree",
    ).map((row) => row.worktree);
    opencodeVersion =
      query<VersionRow>(
        connected.db,
        "SELECT version FROM session WHERE version IS NOT NULL AND trim(version) <> '' GROUP BY version ORDER BY count(*) DESC, version ASC LIMIT 1",
      )[0]?.version ?? null;
  }

  const parsedConfig = readOpencodeConfig({ projectWorktrees });
  const data: SettingsResponse = {
    dbPath: located.found ? located.path : null,
    schemaVersion,
    opencodeVersion,
    storage: located.found ? computeStorageSizes(located.path) : EMPTY_STORAGE,
    config: parsedConfig ? redactConfig(parsedConfig) : null,
  };
  return NextResponse.json(envelope(data));
}

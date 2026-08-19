import type { DatabaseSync } from "node:sqlite";
import { query } from "@/lib/db/connection";
import { decodePartData, mergeWarnings } from "@/lib/decode";
import { callSignature, isSignaturable } from "@/lib/loops";
import { detectLoops } from "@/lib/queries/loops";
import type {
  LoopDiagnosticsReport,
  LoopDiagnosticsTool,
  LoopKind,
  OcWarning,
} from "@/types/oc";
import type { PartQueryFilter, QueryResult } from "@/lib/queries/tools";

/**
 * Calibration evidence for loop detection, safe to carry off the machine.
 *
 * The problem this solves: thresholds and coverage cannot be tuned against a
 * machine with almost no history, and the developer database cannot simply be
 * copied somewhere else — it holds the user's entire agent history. So this
 * emits the *shape* of that history and nothing else: tool names, input key
 * names, the JSON types of those keys, counts, and histograms.
 *
 * **No values.** Not paths, not commands, not contents, not ids, not titles.
 * The one judgement call is that tool *names* are included, which reveals which
 * MCP servers are configured; that is unavoidable for the analysis and is
 * restated inside the payload so anyone reading the file can see the policy.
 */

/** Most input keys reported per tool, so a pathological tool cannot bloat the file. */
const MAX_INPUT_KEYS_PER_TOOL = 50;

/** `minRepeats` values swept, to pick a threshold from evidence rather than taste. */
const THRESHOLDS = [2, 3, 4, 5] as const;

const KINDS: LoopKind[] = ["error-retry", "redundant-repeat", "oscillation"];

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

interface ToolAccumulator {
  calls: number;
  signaturable: number;
  /** signature -> per-session counts, so repeats are counted within a session, never across. */
  signatureBySession: Map<string, Map<string, number>>;
  keyOccurrences: Map<string, number>;
  keyTypes: Map<string, Set<string>>;
}

function accumulator(): ToolAccumulator {
  return {
    calls: 0,
    signaturable: 0,
    signatureBySession: new Map(),
    keyOccurrences: new Map(),
    keyTypes: new Map(),
  };
}

function summariseTool(tool: string, acc: ToolAccumulator): LoopDiagnosticsTool {
  const distinct = new Set<string>();
  const repeatCounts = new Map<number, number>();
  let maxRepeat = 0;

  for (const [signature, bySession] of acc.signatureBySession) {
    distinct.add(signature);
    for (const count of bySession.values()) {
      if (count > maxRepeat) maxRepeat = count;
      if (count > 1) repeatCounts.set(count, (repeatCounts.get(count) ?? 0) + 1);
    }
  }

  const keys = [...acc.keyOccurrences]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, occurrences]) => ({
      key,
      occurrences,
      jsonTypes: [...(acc.keyTypes.get(key) ?? new Set<string>())].sort(),
    }));

  return {
    tool,
    calls: acc.calls,
    signaturable: acc.signaturable,
    distinctSignatures: distinct.size,
    maxRepeatInSession: maxRepeat,
    repeatHistogram: [...repeatCounts]
      .sort((a, b) => a[0] - b[0])
      .map(([repeats, signatures]) => ({ repeats, signatures })),
    inputKeys: keys.slice(0, MAX_INPUT_KEYS_PER_TOOL),
    inputKeysTruncated: keys.length > MAX_INPUT_KEYS_PER_TOOL,
  };
}

export function loopDiagnostics(
  db: DatabaseSync,
  filter: PartQueryFilter = {},
): QueryResult<LoopDiagnosticsReport> {
  const warnings: OcWarning[] = [];
  const tools = new Map<string, ToolAccumulator>();
  let toolCalls = 0;

  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filter.from !== undefined) { clauses.push("p.time_created >= ?"); params.push(filter.from); }
  if (filter.to !== undefined) { clauses.push("p.time_created < ?"); params.push(filter.to); }
  if (filter.projectId !== undefined) { clauses.push("s.project_id = ?"); params.push(filter.projectId); }
  if (filter.agent !== undefined) { clauses.push("COALESCE(s.agent, 'unknown') = ?"); params.push(filter.agent); }
  if (filter.sessionId !== undefined) { clauses.push("p.session_id = ?"); params.push(filter.sessionId); }

  const rows = query<{ session_id: string; data: string }>(
    db,
    `SELECT p.session_id, p.data FROM part p JOIN session s ON s.id = p.session_id
     ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}`,
    params,
  );

  for (const row of rows) {
    const decoded = decodePartData(row.data);
    warnings.push(...decoded.warnings);
    if (decoded.value.type !== "tool") continue;
    toolCalls++;

    const acc = tools.get(decoded.value.tool) ?? accumulator();
    tools.set(decoded.value.tool, acc);
    acc.calls++;

    const input = decoded.value.input;
    if (!isSignaturable(input)) continue;
    acc.signaturable++;

    // Key names and their JSON types only — the values are never touched.
    for (const [key, value] of Object.entries(input)) {
      acc.keyOccurrences.set(key, (acc.keyOccurrences.get(key) ?? 0) + 1);
      const types = acc.keyTypes.get(key) ?? new Set<string>();
      types.add(jsonType(value));
      acc.keyTypes.set(key, types);
    }

    const signature = callSignature(decoded.value.tool, input);
    if (signature === null) continue;
    const bySession = acc.signatureBySession.get(signature) ?? new Map<string, number>();
    bySession.set(row.session_id, (bySession.get(row.session_id) ?? 0) + 1);
    acc.signatureBySession.set(signature, bySession);
  }

  const counts = query<{ sessions: number; messages: number; parts: number }>(
    db,
    `SELECT (SELECT COUNT(*) FROM session) AS sessions,
            (SELECT COUNT(*) FROM message) AS messages,
            (SELECT COUNT(*) FROM part) AS parts`,
  )[0] ?? { sessions: 0, messages: 0, parts: 0 };

  const versions = query<{ version: string | null; sessions: number }>(
    db,
    "SELECT version, COUNT(*) AS sessions FROM session GROUP BY version ORDER BY sessions DESC",
  ).map((row) => ({ version: row.version ?? "unknown", sessions: row.sessions }));

  // Coverage comes from the detector itself, so the report cannot drift from it.
  const base = detectLoops(db, filter);
  warnings.push(...base.warnings);

  const thresholdSweep = THRESHOLDS.map((minRepeats) => {
    const run = minRepeats === THRESHOLDS[0] ? base : detectLoops(db, filter, undefined, { minRepeats });
    const byKind = KINDS.map((kind) => ({
      kind,
      incidents: run.data.incidents.filter((incident) => incident.kind === kind).length,
    }));
    return {
      minRepeats,
      incidents: run.data.incidents.length,
      wastedCalls: run.data.totalWastedCalls,
      byKind,
    };
  });

  return {
    data: {
      redaction: {
        valuesIncluded: false,
        note:
          "Shape only: tool names, input key names, their JSON types, counts and histograms. " +
          "No ids, paths, titles, commands, file contents, or any other value from the database.",
      },
      scale: {
        sessions: counts.sessions,
        messages: counts.messages,
        parts: counts.parts,
        toolCalls,
      },
      opencodeVersions: versions,
      tools: [...tools]
        .map(([tool, acc]) => summariseTool(tool, acc))
        .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool)),
      coverage: base.data.coverage,
      thresholdSweep,
    },
    warnings: mergeWarnings([warnings]),
  };
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

interface KeyShape {
  occurrences: Map<string, number>;
  types: Map<string, Set<string>>;
}

interface ToolAccumulator {
  calls: number;
  signaturable: number;
  callsWithOutput: number;
  /** signature -> per-session counts, so repeats are counted within a session, never across. */
  signatureBySession: Map<string, Map<string, number>>;
  input: KeyShape;
  metadata: KeyShape;
}

function keyShape(): KeyShape {
  return { occurrences: new Map(), types: new Map() };
}

/** Records key *names* and their JSON types. The values are never touched. */
function recordKeys(shape: KeyShape, record: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(record)) {
    shape.occurrences.set(key, (shape.occurrences.get(key) ?? 0) + 1);
    const types = shape.types.get(key) ?? new Set<string>();
    types.add(jsonType(value));
    shape.types.set(key, types);
  }
}

function summariseKeys(shape: KeyShape): Array<{ key: string; occurrences: number; jsonTypes: string[] }> {
  return [...shape.occurrences]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, occurrences]) => ({
      key,
      occurrences,
      jsonTypes: [...(shape.types.get(key) ?? new Set<string>())].sort(),
    }));
}

function accumulator(): ToolAccumulator {
  return {
    calls: 0,
    signaturable: 0,
    callsWithOutput: 0,
    signatureBySession: new Map(),
    input: keyShape(),
    metadata: keyShape(),
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

  const keys = summariseKeys(acc.input);

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
    metadataKeys: summariseKeys(acc.metadata).slice(0, MAX_INPUT_KEYS_PER_TOOL),
    callsWithOutput: acc.callsWithOutput,
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

    if (decoded.value.output !== null && decoded.value.output.length > 0) acc.callsWithOutput++;

    // `state.metadata` is read straight off the row: the decoder does not carry
    // it, and only its key names leave this function.
    try {
      const raw: unknown = JSON.parse(row.data);
      const state = isRecord(raw) ? raw["state"] : undefined;
      const metadata = isRecord(state) ? state["metadata"] : undefined;
      if (isRecord(metadata)) recordKeys(acc.metadata, metadata);
    } catch {
      // A malformed row is already counted by the decoder's own warning.
    }

    const input = decoded.value.input;
    if (!isSignaturable(input)) continue;
    acc.signaturable++;
    recordKeys(acc.input, input);

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

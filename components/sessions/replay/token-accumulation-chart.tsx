"use client";

import { TriangleAlert } from "lucide-react";

import { AreaChartCard } from "@/components/charts/area-chart-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";
import type { OcTokens, SessionReplay } from "@/types/oc";

export interface TokenAccumulationRow extends Record<string, string | number> {
  turn: string;
  turnIndex: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

function tokenTotal(tokens: OcTokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite;
}

function finiteTokens(tokens: OcTokens): boolean {
  return Object.values(tokens).every((value) => Number.isFinite(value) && value >= 0);
}

function safeToken(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function tokenAccumulationRows(points: SessionReplay["tokenAccumulation"]): TokenAccumulationRow[] {
  return points.map((point) => ({
    turn: `Turn ${point.atTurnIndex + 1}`,
    turnIndex: point.atTurnIndex,
    input: safeToken(point.tokens.input),
    output: safeToken(point.tokens.output),
    reasoning: safeToken(point.tokens.reasoning),
    cacheRead: safeToken(point.tokens.cacheRead),
    cacheWrite: safeToken(point.tokens.cacheWrite),
  }));
}

export interface TokenEvidenceStatus {
  matches: boolean;
  finalTotal: number;
  sessionTotal: number;
  invalidEvidence: boolean;
}

export interface TokenReplayEvidence {
  session: Pick<SessionReplay["session"], "tokens">;
  tokenAccumulation: SessionReplay["tokenAccumulation"];
}

export function tokenEvidenceStatus(replay: TokenReplayEvidence): TokenEvidenceStatus {
  const final = replay.tokenAccumulation.at(-1)?.tokens;
  const sessionTokens = replay.session.tokens;
  const invalidEvidence = !finiteTokens(sessionTokens) || replay.tokenAccumulation.some((point) => !finiteTokens(point.tokens));
  const finalTotal = final && finiteTokens(final) ? tokenTotal(final) : 0;
  const sessionTotal = finiteTokens(sessionTokens) ? tokenTotal(sessionTokens) : 0;
  const matches = !invalidEvidence && (
    final === undefined
      ? sessionTotal === 0
      : final.input === sessionTokens.input
        && final.output === sessionTokens.output
        && final.reasoning === sessionTokens.reasoning
        && final.cacheRead === sessionTokens.cacheRead
        && final.cacheWrite === sessionTokens.cacheWrite
  );
  return { matches, finalTotal, sessionTotal, invalidEvidence };
}

export function TokenAccumulationChart({ replay }: { replay: TokenReplayEvidence }) {
  const rows = tokenAccumulationRows(replay.tokenAccumulation);
  const status = tokenEvidenceStatus(replay);
  return (
    <section aria-labelledby="token-accumulation-title" className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="token-accumulation-title" className="font-semibold">Token accumulation</h2><p className="mt-1 text-xs text-muted-foreground">Running step-finish evidence across the ordered turn stream.</p></div>
        <Badge variant={status.matches ? "secondary" : "outline"}>{status.matches ? "Matches session total" : "Evidence mismatch"}</Badge>
      </div>
      {!status.matches ? (
        <Alert className="border-warning/40 bg-warning/5">
          <TriangleAlert aria-hidden="true" className="text-warning" />
          <AlertTitle>Token evidence differs</AlertTitle>
          <AlertDescription>{status.invalidEvidence ? "Token evidence contains an invalid value; the chart substitutes zero only for safe rendering." : `Step-finish evidence totals ${formatNumber(status.finalTotal)} tokens, while the session aggregate reports ${formatNumber(status.sessionTotal)}.`}</AlertDescription>
        </Alert>
      ) : null}
      <AreaChartCard
        data={rows}
        xKey="turn"
        xLabel="Turn"
        series={[
          { key: "input", label: "Input" },
          { key: "output", label: "Output" },
          { key: "reasoning", label: "Reasoning" },
          { key: "cacheRead", label: "Cache read" },
          { key: "cacheWrite", label: "Cache write" },
        ]}
        stacked
        emptyMessage="No step-finish token evidence is available for this session."
        height={300}
      />
    </section>
  );
}

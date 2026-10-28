"use client";

import { useMemo, useState } from "react";
import { ChevronRight, FileUp, ShieldCheck, TriangleAlert } from "lucide-react";

import { ErrorState } from "@/components/states/error-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOc } from "@/hooks/use-oc";
import { BILL_TEMPLATE, parseBillCsv, reconcile, type ParsedBill } from "@/lib/audit/bill";
import { formatNumber } from "@/lib/format";

const METRIC_LABELS = { input: "input", output: "output", cacheRead: "cache read", cacheWrite: "cache write" } as const;
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([BILL_TEMPLATE], { type: "text/csv" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "provider-bill-template.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Compares the provider's daily usage export with opencode's recorded usage.
 * The file is read in the browser and never leaves it.
 */
export function BillCheck({ range }: { range: string }) {
  const [billZone, setBillZone] = useState<"UTC" | "local">("UTC");
  const [bill, setBill] = useState<ParsedBill | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const timeZone = billZone === "UTC" ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  // The bill decides which days matter, so recorded usage is always read for all time.
  const recorded = useOc(`/api/costs/daily?range=all&tz=${encodeURIComponent(timeZone)}`, { enabled: bill?.ok === true, polling: false });
  const result = useMemo(() => (bill?.ok && recorded.data ? reconcile(bill, recorded.data.data) : null), [bill, recorded.data]);

  async function load(file: File) {
    setFileName(file.name);
    setBill(parseBillCsv(await file.text()));
  }

  return (
    <details open className="group overflow-hidden rounded-lg border border-border bg-card shadow-xs">
      <summary className="flex cursor-pointer list-none items-start gap-2 p-4 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <div><h2 className="font-semibold">Compare with your provider bill</h2><p className="mt-1 text-xs text-muted-foreground">The only way to see whether failed or retried calls were charged. Load your provider&apos;s daily usage CSV; it is read in this browser and never uploaded or saved.</p></div>
      </summary>
      <div className="space-y-4 border-t border-border p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted">
            <FileUp aria-hidden="true" className="size-4" />{fileName ?? "Choose bill CSV"}
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void load(file); }} />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground"><span className="block">Bill days are in</span>
            <select aria-label="Bill time zone" className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground" value={billZone} onChange={(event) => setBillZone(event.target.value as "UTC" | "local")}><option value="UTC">UTC (most providers)</option><option value="local">My local time</option></select>
          </label>
          <Button variant="ghost" size="sm" onClick={downloadTemplate}>Download CSV template</Button>
        </div>
        <p className="text-xs text-muted-foreground">Recognised columns: <span className="font-mono">date</span> plus any of <span className="font-mono">input_tokens</span>, <span className="font-mono">output_tokens</span>, <span className="font-mono">cache_read_tokens</span>, <span className="font-mono">cache_write_tokens</span>, <span className="font-mono">cost_usd</span> (and common provider names such as <span className="font-mono">prompt_tokens</span>/<span className="font-mono">completion_tokens</span>). Several rows on the same day are added up. Bill days are compared over all time, not just the {range} range above.</p>

        {bill && !bill.ok ? <Alert variant="destructive"><TriangleAlert aria-hidden="true" /><AlertTitle>That file could not be read</AlertTitle><AlertDescription>{bill.error}</AlertDescription></Alert> : null}
        {bill?.ok && recorded.error ? <ErrorState title="Recorded usage could not be loaded" message={recorded.error.message} onRetry={() => void recorded.mutate()} /> : null}
        {bill?.ok && !recorded.data && !recorded.error ? <Skeleton className="h-40 rounded-lg" /> : null}

        {result ? <>
          {result.flaggedDays > 0
            ? <Alert className="border-warning/40 bg-warning/5"><TriangleAlert aria-hidden="true" className="text-warning" /><AlertTitle>Billed for more than opencode recorded on {result.flaggedDays} day{result.flaggedDays === 1 ? "" : "s"}</AlertTitle><AlertDescription>{formatNumber(result.totalTokenGap)} tokens on the bill have no matching usage in opencode. That is what failed or retried calls, other apps using the same API key, or a provider counting error would look like.</AlertDescription></Alert>
            : <Alert><ShieldCheck aria-hidden="true" /><AlertTitle>No day billed above what opencode recorded</AlertTitle><AlertDescription>Within a 5% / 1,000-token tolerance{result.comparedMetrics.length > 0 ? `, comparing ${result.comparedMetrics.map((metric) => METRIC_LABELS[metric]).join(", ")} tokens` : ""}.</AlertDescription></Alert>}
          {bill?.ok && bill.skippedRows > 0 ? <p className="text-xs text-muted-foreground">{bill.skippedRows} row{bill.skippedRows === 1 ? "" : "s"} without a YYYY-MM-DD date were skipped.</p> : null}
          <div className="max-w-full overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Day ({billZone === "UTC" ? "UTC" : "local"})</th><th className="px-3 py-2 text-right font-medium">Billed tokens</th><th className="px-3 py-2 text-right font-medium">Recorded by opencode</th><th className="px-3 py-2 text-right font-medium">Difference</th><th className="px-3 py-2 text-right font-medium">Billed cost</th><th className="px-3 py-2 text-right font-medium">oc-lens cost</th></tr></thead>
              <tbody className="divide-y divide-border">{[...result.days].reverse().map((day) => (
                <tr key={day.date} className={day.flagged ? "bg-warning/10" : undefined}>
                  <td className="px-3 py-2 font-mono">{day.date}{day.flagged ? <TriangleAlert aria-label="Billed above recorded" className="ml-2 inline size-3.5 text-warning" /> : null}</td>
                  <td className="px-3 py-2 text-right font-mono">{day.billedTokens === null ? "—" : formatNumber(day.billedTokens)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatNumber(day.recordedTokens)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${day.flagged ? "font-semibold text-warning" : "text-muted-foreground"}`}>{day.tokenGap === null ? "—" : signed(day.tokenGap)}</td>
                  <td className="px-3 py-2 text-right font-mono">{day.billedCost === null ? "—" : usd.format(day.billedCost)}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">{day.recordedCost === null ? "not priced" : usd.format(day.recordedCost)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Read the difference with care: providers count tokens with their own tokenizer, some include cached tokens in &quot;input&quot;, and the bill covers every app using that API key. A steady small gap is normal; a gap on the days with failures above is the signal.</p>
        </> : null}
      </div>
    </details>
  );
}

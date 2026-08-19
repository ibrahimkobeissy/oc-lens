import { ShieldAlert } from "lucide-react";
import { formatNumber } from "@/lib/format";
import type { LoopCoverage } from "@/types/oc";

/**
 * How much of the data could actually be examined.
 *
 * This is not decoration. opencode records no input for several tools, and
 * repeats inside those are undetectable — so "no loops found" would otherwise
 * read as a clean bill of health the data cannot support. The page says what it
 * could not check, in the same breath as what it did.
 */
export function LoopCoverageNote({ coverage }: { coverage: LoopCoverage }) {
  if (coverage.toolCalls === 0) return null;

  const percent = Math.round((coverage.signaturable / coverage.toolCalls) * 100);
  const hasBlindSpot = coverage.unsignaturable > 0;

  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4"
      data-slot="loop-coverage"
    >
      <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 text-sm">
        <p className="font-medium text-foreground">
          Checked {formatNumber(coverage.signaturable)} of {formatNumber(coverage.toolCalls)} tool calls ({percent}%)
        </p>
        {hasBlindSpot ? (
          <p className="mt-1 text-muted-foreground">
            {formatNumber(coverage.unsignaturable)} calls could not be checked because opencode recorded no input
            for them, so repeats inside them are invisible here — not absent.
            {coverage.unsignaturableTools.length > 0 && (
              <>
                {" "}
                Affected tools:{" "}
                <span className="font-mono text-xs text-foreground">
                  {coverage.unsignaturableTools.join(", ")}
                </span>
                .
              </>
            )}
          </p>
        ) : (
          <p className="mt-1 text-muted-foreground">
            Every tool call in this range recorded an input, so all of them could be compared.
          </p>
        )}
      </div>
    </div>
  );
}

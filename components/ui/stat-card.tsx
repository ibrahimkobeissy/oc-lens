"use client";

import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface StatCardDelta {
  value: number;
  direction: "up" | "down" | "flat";
  label?: string;
}

interface StatCardProps {
  label: string;
  /** A number animates on change; a string (e.g. "not priced") renders as-is, no animation. */
  value: number | string;
  formatValue?: (value: number) => string;
  delta?: StatCardDelta;
  subLabel?: string;
  tooltip?: string;
}

/** Eases a displayed number from its previous value to the next over ~500ms, so a stat card update reads as a change rather than a jump-cut. */
function useAnimatedNumber(target: number, durationMs = 500): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    let frame: number;

    function tick(now: number) {
      const progress = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (target - from) * eased);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return display;
}

export function StatCard({ label, value, formatValue, delta, subLabel, tooltip }: StatCardProps) {
  const isNumeric = typeof value === "number";
  const animated = useAnimatedNumber(isNumeric ? value : 0);
  const roundedAnimated = Math.round(animated);
  const displayValue = isNumeric
    ? formatValue
      ? formatValue(roundedAnimated)
      : roundedAnimated.toLocaleString("en-US")
    : value;

  return (
    <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        {tooltip && (
          // Self-contained provider: StatCard is a standalone primitive other
          // tickets drop into any page, so it can't assume an ancestor already
          // wrapped the tree in TooltipProvider. Nesting one here is harmless
          // even if a page also has an outer provider.
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3" aria-label={tooltip} />
              </TooltipTrigger>
              <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{displayValue}</div>
      {(delta || subLabel) && (
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          {delta && (
            <span
              className={cn(
                "font-medium",
                delta.direction === "up" && "text-success",
                delta.direction === "down" && "text-destructive",
              )}
            >
              {delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "–"} {Math.abs(delta.value)}
              {delta.label ? ` ${delta.label}` : ""}
            </span>
          )}
          {subLabel && <span>{subLabel}</span>}
        </div>
      )}
    </div>
  );
}

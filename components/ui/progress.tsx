"use client"

import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// Clamped to [0, 100] — an out-of-range `value` would otherwise translate the indicator
// off-canvas (code-review-2026-08-02.md L3). Only NaN needs a special-cased fallback:
// Math.min/Math.max already clamp +/-Infinity to 100/0 correctly on their own, but any
// comparison against NaN is false, so it would otherwise propagate through unclamped.
export function clampedProgress(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - clampedProgress(value)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }

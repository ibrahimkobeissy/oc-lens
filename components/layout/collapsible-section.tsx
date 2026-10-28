"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
  title: ReactNode;
  description?: ReactNode;
  /** Shown on the header row even while collapsed — a count, a badge. Kept outside the toggle so clicks on it do not collapse. */
  aside?: ReactNode;
  children: ReactNode;
  /** Uncontrolled initial state. Collapsed unless asked otherwise. */
  defaultOpen?: boolean;
  /** Controlled state, for a section something else must be able to open (e.g. a jump into the conversation). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  bodyClassName?: string;
  "aria-label"?: string;
}

/**
 * The bordered, collapsible card every session-page panel uses. A native
 * <details>, so it works without JavaScript and keeps its content in the DOM
 * for in-page search.
 */
export function CollapsibleSection({ title, description, aside, children, defaultOpen = false, open, onOpenChange, className, bodyClassName, "aria-label": ariaLabel }: CollapsibleSectionProps) {
  const controlled = open !== undefined;
  return (
    <details
      aria-label={ariaLabel}
      className={cn("group rounded-lg border border-border bg-card", className)}
      {...(controlled ? { open } : defaultOpen ? { open: true } : {})}
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-start gap-2 p-4 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold">{title}</h2>
          {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {aside ? <div className="shrink-0" onClick={(event) => event.preventDefault()}>{aside}</div> : null}
      </summary>
      <div className={cn("border-t border-border p-4", bodyClassName)}>{children}</div>
    </details>
  );
}

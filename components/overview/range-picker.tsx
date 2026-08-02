"use client";

import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { CalendarDays } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type PresetRange = "7d" | "30d" | "90d" | "all";
export type RangeSelection = { kind: "preset"; value: PresetRange } | { kind: "custom"; from: number; to: number };

const PRESETS: Array<{ value: PresetRange; label: string }> = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" },
];

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function customLabel(from: number, to: number): string {
  return `${dateFormatter.format(new Date(from))} – ${dateFormatter.format(new Date(to))}`;
}

/** Segmented preset chips (7d/30d/90d/All) plus a custom-range calendar picker, replacing a plain `<select>`. */
export function RangePicker({ value, onChange }: { value: RangeSelection; onChange: (next: RangeSelection) => void }) {
  const [draft, setDraft] = useState<DateRange | undefined>(value.kind === "custom" ? { from: new Date(value.from), to: new Date(value.to) } : undefined);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <div role="group" aria-label="Preset date range" className="flex items-center gap-0.5 rounded-md border border-input bg-background p-0.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            aria-pressed={value.kind === "preset" && value.value === preset.value}
            onClick={() => onChange({ kind: "preset", value: preset.value })}
            className={cn(
              "rounded px-2.5 py-1.5 text-sm font-medium transition-colors",
              value.kind === "preset" && value.value === preset.value ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next && value.kind === "custom") setDraft({ from: new Date(value.from), to: new Date(value.to) }); }}>
        <PopoverTrigger asChild>
          <Button type="button" variant={value.kind === "custom" ? "secondary" : "outline"} size="sm" className="gap-1.5">
            <CalendarDays aria-hidden="true" className="size-3.5" />
            {value.kind === "custom" ? customLabel(value.from, value.to) : "Pick a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <Calendar mode="range" selected={draft} onSelect={setDraft} numberOfMonths={1} disabled={{ after: new Date() }} />
          <div className="flex justify-end gap-2 border-t border-border p-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              type="button"
              size="sm"
              disabled={!draft?.from || !draft.to}
              onClick={() => {
                if (!draft?.from || !draft.to) return;
                const dayMs = 86_400_000;
                const from = draft.from.getTime();
                const to = draft.to.getTime() + dayMs - 1; // include the entire end day
                onChange({ kind: "custom", from, to });
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

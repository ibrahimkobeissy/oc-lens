import { ChevronRight, ShieldBan } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { RedactedConfigValue } from "@/types/oc";

function RedactedValue() {
  return (
    <Badge
      variant="outline"
      className="border-warning/40 bg-warning/10 font-mono text-warning"
      aria-label="Redacted value; the original value is not available"
    >
      <ShieldBan aria-hidden="true" /> [redacted]
    </Badge>
  );
}

function PrimitiveValue({ value }: { value: string | number | boolean | null }) {
  if (value === "[redacted]") return <RedactedValue />;
  if (value === null) return <span className="font-mono text-muted-foreground">null</span>;
  if (typeof value === "string") return <span className="break-all font-mono text-foreground">{JSON.stringify(value)}</span>;
  return <span className="font-mono text-foreground">{String(value)}</span>;
}

function ConfigNode({ label, value, depth }: { label: string; value: RedactedConfigValue; depth: number }) {
  if (Array.isArray(value)) {
    return (
      <details open={depth < 1} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-sm hover:text-foreground">
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
          <span className="font-mono font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">Array({value.length})</span>
        </summary>
        <div className="ml-2 border-l border-border pl-4">
          {value.length === 0
            ? <p className="py-1 text-xs text-muted-foreground">Empty array</p>
            : value.map((child, index) => <ConfigNode key={index} label={String(index)} value={child} depth={depth + 1} />)}
        </div>
      </details>
    );
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return (
      <details open={depth < 1} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-sm hover:text-foreground">
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
          <span className="font-mono font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">Object({entries.length})</span>
        </summary>
        <div className="ml-2 border-l border-border pl-4">
          {entries.length === 0
            ? <p className="py-1 text-xs text-muted-foreground">Empty object</p>
            : entries.map(([key, child]) => <ConfigNode key={key} label={key} value={child} depth={depth + 1} />)}
        </div>
      </details>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(7rem,auto)_1fr] items-start gap-3 py-1 text-sm">
      <span className="font-mono text-muted-foreground">{label}</span>
      <PrimitiveValue value={value} />
    </div>
  );
}

export function ConfigTree({ value }: { value: Record<string, RedactedConfigValue> }) {
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">The config object is empty.</p>;
  return (
    <div className="max-h-[32rem] overflow-auto rounded-lg border border-border bg-muted/30 p-3" aria-label="Redacted opencode configuration">
      {entries.map(([key, child]) => <ConfigNode key={key} label={key} value={child} depth={0} />)}
    </div>
  );
}

"use client";

import { RotateCcw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface SessionFilterValues {
  search: string;
  project: string;
  agent: string;
  model: string;
  from: string;
  to: string;
  archived: string;
  hasError: string;
  isSubagent: string;
}

interface SessionFiltersProps {
  values: SessionFilterValues;
  onChange: (name: keyof SessionFilterValues, value: string) => void;
  onReset: () => void;
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-xs dark:bg-input/30" value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

export function SessionFilters({ values, onChange, onReset }: SessionFiltersProps) {
  return (
    <section aria-label="Session filters" className="rounded-lg border border-border bg-card p-3 shadow-xs">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className="space-y-1 text-xs font-medium text-muted-foreground sm:col-span-2">
          <span>Search</span>
          <span className="relative block">
            <Search aria-hidden="true" className="absolute left-2.5 top-2.5 size-4" />
            <Input className="pl-8" value={values.search} placeholder="Title, slug, session id…" onChange={(event) => onChange("search", event.target.value)} />
          </span>
        </label>
        {(["project", "agent", "model"] as const).map((name) => (
          <label key={name} className="space-y-1 text-xs font-medium capitalize text-muted-foreground">
            <span>{name}</span>
            <Input value={values[name]} placeholder={`Any ${name}`} onChange={(event) => onChange(name, event.target.value)} />
          </label>
        ))}
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          <span>From</span>
          <Input type="date" value={values.from} onChange={(event) => onChange("from", event.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          <span>To</span>
          <Input type="date" value={values.to} onChange={(event) => onChange("to", event.target.value)} />
        </label>
        <FilterSelect label="Archive" value={values.archived} onChange={(value) => onChange("archived", value)}>
          <option value="">All</option><option value="false">Active</option><option value="true">Archived</option>
        </FilterSelect>
        <FilterSelect label="Errors" value={values.hasError} onChange={(value) => onChange("hasError", value)}>
          <option value="">All</option><option value="true">Has errors</option><option value="false">No errors</option>
        </FilterSelect>
        <FilterSelect label="Session type" value={values.isSubagent} onChange={(value) => onChange("isSubagent", value)}>
          <option value="">All</option><option value="false">Root sessions</option><option value="true">Subagents</option>
        </FilterSelect>
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onReset}><RotateCcw aria-hidden="true" />Reset filters</Button>
      </div>
    </section>
  );
}

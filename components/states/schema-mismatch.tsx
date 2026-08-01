import { TriangleAlert } from "lucide-react";

interface SchemaMismatchProps {
  schemaVersion: string;
  table?: string;
  missingColumns?: readonly string[];
  message?: string;
}

/** Full-page refusal state: unsupported schemas must never render plausible numbers. */
export function SchemaMismatch({
  schemaVersion,
  table,
  missingColumns = [],
  message,
}: SchemaMismatchProps) {
  return (
    <section className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-5 py-12">
      <div className="w-full max-w-2xl rounded-xl border border-warning/40 bg-card p-6 shadow-sm sm:p-10">
        <TriangleAlert aria-hidden="true" className="mb-5 size-10 text-warning" />
        <p className="mb-2 font-mono text-xs font-medium uppercase tracking-wider text-warning">
          Schema mismatch
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">This database is not compatible</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          {message ?? "oc-lens stopped before running analytics because the database shape differs from the version it was verified against."}
        </p>

        <dl className="mt-6 grid gap-4 rounded-lg border border-border bg-muted p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Pinned schema version</dt>
            <dd className="mt-1 font-mono text-foreground">{schemaVersion}</dd>
          </div>
          {table && (
            <div>
              <dt className="text-xs text-muted-foreground">First mismatched table</dt>
              <dd className="mt-1 font-mono text-foreground">{table}</dd>
            </div>
          )}
          {missingColumns.length > 0 && (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Missing columns</dt>
              <dd className="mt-1 break-words font-mono text-foreground">{missingColumns.join(", ")}</dd>
            </div>
          )}
        </dl>

        <p className="mt-6 text-xs leading-5 text-muted-foreground">
          Update oc-lens to a version that supports this opencode schema. No analytics were rendered.
        </p>
      </div>
    </section>
  );
}

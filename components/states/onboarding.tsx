import { Database, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";

interface OnboardingProps {
  searched?: readonly string[];
}

/** Full-page state used when the opencode database locator returns not-found. */
export function Onboarding({ searched = [] }: OnboardingProps) {
  const locations = searched.length > 0
    ? searched
    : [
        "$OC_LENS_DB (when set)",
        "$XDG_DATA_HOME/opencode/opencode.db (when set)",
        "~/.local/share/opencode/opencode.db",
      ];

  return (
    <section className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-5 py-12">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-sm sm:p-10">
        <Database aria-hidden="true" className="mb-5 size-10 text-primary" />
        <p className="mb-2 font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Database not found
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Connect your opencode history</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          oc-lens is a read-only view of your local opencode database. Start opencode once to create it,
          or point oc-lens at an existing database with <code className="font-mono text-foreground">OC_LENS_DB</code>.
        </p>

        <div className="mt-6 rounded-lg border border-border bg-muted p-4">
          <p className="text-xs font-medium text-foreground">Start with a custom database path</p>
          <code className="mt-2 block overflow-x-auto whitespace-nowrap font-mono text-xs text-muted-foreground">
            OC_LENS_DB=/absolute/path/to/opencode.db pnpm dev
          </code>
        </div>

        <div className="mt-6">
          <p className="text-xs font-medium text-foreground">Locations checked</p>
          <ul className="mt-2 space-y-1" aria-label="Database locations checked">
            {locations.map((path) => (
              <li key={path} className="break-all font-mono text-xs text-muted-foreground">
                {path}
              </li>
            ))}
          </ul>
        </div>

        <Button asChild className="mt-7">
          <a href="https://opencode.ai/docs" target="_blank" rel="noreferrer">
            Open opencode documentation <ExternalLink aria-hidden="true" />
          </a>
        </Button>
      </div>
    </section>
  );
}

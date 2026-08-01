"use client";

import { Activity, CircleAlert, CircleCheck, ServerOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useOc } from "@/hooks/use-oc";
import type { LiveEndpointHealth } from "@/types/oc";

function ServiceList({ label, endpoint }: { label: string; endpoint: LiveEndpointHealth }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <Badge variant={endpoint.available ? "secondary" : "outline"}>
          {endpoint.available ? "available" : "unavailable"}
        </Badge>
      </div>
      {endpoint.items.length > 0 ? (
        <ul className="mt-3 space-y-2" aria-label={`${label} statuses`}>
          {endpoint.items.map((item) => (
            <li key={`${item.name}-${item.status}`} className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-muted-foreground">{item.name}</span>
              <Badge variant="outline">{item.status}</Badge>
            </li>
          ))}
        </ul>
      ) : endpoint.available ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {endpoint.itemCount === 0 ? `No ${label} entries reported.` : "Endpoint responded without status entries."}
        </p>
      ) : null}
    </div>
  );
}

/** Optional live health. Historical analytics never depend on this panel. */
export function HealthPanel() {
  const { data, error, isLoading, mutate } = useOc("/api/health", { polling: 30_000 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Activity className="size-4" />Live server health</CardTitle>
        <CardDescription>Optional status from a running opencode HTTP server.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-sm text-muted-foreground">Checking opencode server…</p> : null}
        {error ? (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <div><p>Health check failed.</p><button className="mt-2 underline" type="button" onClick={() => void mutate()}>Retry</button></div>
          </div>
        ) : null}
        {data?.data.state === "disabled" ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Live health is off. Set <code className="rounded bg-muted px-1 py-0.5 text-foreground">OC_LENS_OPENCODE_URL</code> to opt in.</p>
            <p>Then start the server with <code className="rounded bg-muted px-1 py-0.5 text-foreground">opencode serve</code>.</p>
          </div>
        ) : null}
        {data?.data.state === "not-running" ? (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <ServerOff className="mt-0.5 size-4 shrink-0" />
            <div><p className="font-medium text-foreground">opencode server not running</p><p className="mt-1">Start it with <code className="rounded bg-muted px-1 py-0.5 text-foreground">opencode serve</code>.</p></div>
          </div>
        ) : null}
        {data?.data.state === "running" ? (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm"><CircleCheck className="size-4 text-success" />Connected to {data.data.baseUrl}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <ServiceList label="MCP" endpoint={data.data.mcp} />
              <ServiceList label="LSP" endpoint={data.data.lsp} />
            </div>
            <p className="text-xs text-muted-foreground">Agents: {data.data.agent.itemCount ?? "unknown"} · Config endpoint: {data.data.config.available ? "available" : "unavailable"}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

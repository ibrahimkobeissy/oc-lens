import Link from "next/link";
import { Bot, Braces, Boxes, Database, PlugZap, Puzzle, Tags } from "lucide-react";

import { StorageContent } from "@/components/overview/storage-panel";
import { ConfigTree } from "@/components/settings/config-tree";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RedactedConfig, SettingsResponse } from "@/types/oc";

function NameList({ values, empty }: { values: readonly string[]; empty: string }) {
  return values.length > 0 ? (
    <ul className="flex flex-wrap gap-2">
      {values.map((value) => <li key={value}><Badge variant="secondary" className="font-mono">{value}</Badge></li>)}
    </ul>
  ) : <p className="text-xs text-muted-foreground">{empty}</p>;
}

function ConfiguredFeatures({ config }: { config: RedactedConfig }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Boxes aria-hidden="true" className="size-4" />Configured features</CardTitle>
        <CardDescription>Safe names and transport types allowlisted from opencode config.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-3">
        <section aria-labelledby="configured-agents-title">
          <h3 id="configured-agents-title" className="mb-2 flex items-center gap-2 text-sm font-medium"><Bot aria-hidden="true" className="size-4 text-muted-foreground" />Agents</h3>
          <NameList values={config.agents} empty="No configured agents found." />
        </section>
        <section aria-labelledby="configured-mcp-title">
          <h3 id="configured-mcp-title" className="mb-2 flex items-center gap-2 text-sm font-medium"><PlugZap aria-hidden="true" className="size-4 text-muted-foreground" />MCP servers</h3>
          {config.mcpServers.length > 0 ? (
            <ul className="space-y-2">
              {config.mcpServers.map((server) => (
                <li key={server.name} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-xs">
                  <span className="min-w-0 truncate font-mono">{server.name}</span>
                  <Badge variant="outline">{server.transport}</Badge>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted-foreground">No configured MCP servers found.</p>}
        </section>
        <section aria-labelledby="configured-plugins-title">
          <h3 id="configured-plugins-title" className="mb-2 flex items-center gap-2 text-sm font-medium"><Puzzle aria-hidden="true" className="size-4 text-muted-foreground" />Plugins</h3>
          <NameList values={config.plugins} empty="No configured plugins found." />
        </section>
      </CardContent>
    </Card>
  );
}

export function SettingsContent({ settings }: { settings: SettingsResponse }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Database aria-hidden="true" className="size-4" />Environment</CardTitle>
          <CardDescription>Detected local database and compatibility information.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="min-w-0 rounded-lg border border-border p-3 sm:col-span-2 xl:col-span-1">
              <dt className="text-xs text-muted-foreground">Database path</dt>
              <dd className="mt-1 overflow-x-auto whitespace-nowrap font-mono text-sm" title={settings.dbPath ?? undefined}>
                {settings.dbPath ?? <span className="text-warning">Not found</span>}
              </dd>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">Schema version</dt>
              <dd className="mt-1 font-mono text-sm">{settings.schemaVersion}</dd>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">Detected opencode version</dt>
              <dd className="mt-1 font-mono text-sm">{settings.opencodeVersion ?? "Not detected"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Tags aria-hidden="true" className="size-4" />Storage footprint</CardTitle>
          <CardDescription>Read-only disk usage for the detected opencode data directory.</CardDescription>
        </CardHeader>
        <CardContent><StorageContent storage={settings.storage} /></CardContent>
      </Card>

      {settings.config ? (
        <>
          <ConfiguredFeatures config={settings.config} />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Braces aria-hidden="true" className="size-4" />Redacted configuration</CardTitle>
              <CardDescription>Expand safe fields as needed. Sensitive values were removed before this response was created and cannot be revealed here.</CardDescription>
            </CardHeader>
            <CardContent><ConfigTree value={settings.config.raw} /></CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader><CardTitle>opencode configuration</CardTitle></CardHeader>
          <CardContent>
            <EmptyState
              icon={<Braces aria-hidden="true" />}
              title="No config found"
              description="No opencode.jsonc or opencode.json was found in the global config directory or detected project worktrees. Analytics remain available from the database."
            />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Model pricing</CardTitle>
            <CardDescription>Set your own per-million-token rates so cost analytics remain honest.</CardDescription>
          </CardHeader>
          <CardContent><Button asChild><Link href="/settings/pricing">Configure model prices</Link></Button></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Observed skills</CardTitle>
            <CardDescription>opencode exposes no installed-skills inventory or fixed skills directory.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Skill analytics show only skills observed in recorded <code className="font-mono text-foreground">skill</code> tool calls—not everything installed.</p>
            <Button asChild variant="outline"><Link href="/tools">View observed skills</Link></Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

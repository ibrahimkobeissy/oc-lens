import { EmptyState } from "@/components/states/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import type { VersionRecord } from "@/types/oc";

const SEMVER_COLLATOR = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function semverSortedVersions(versions: readonly VersionRecord[]): VersionRecord[] {
  return [...versions].sort((left, right) => SEMVER_COLLATOR.compare(left.version.replace(/^v/, ""), right.version.replace(/^v/, "")) || left.firstSeen - right.firstSeen);
}

export function VersionHistoryTable({ versions }: { versions: VersionRecord[] }) {
  const rows = semverSortedVersions(versions);
  if (rows.length === 0) return <EmptyState title="No version history" description="opencode versions appear after sessions record a version." />;
  return <section className="overflow-hidden rounded-lg border border-border bg-card" aria-labelledby="versions-heading"><header className="border-b border-border p-4"><h2 id="versions-heading" className="font-semibold">Version history</h2><p className="mt-1 text-xs text-muted-foreground">Recorded opencode versions in semantic version order.</p></header><Table><TableHeader><TableRow><TableHead>Version</TableHead><TableHead className="text-right">Sessions</TableHead><TableHead className="text-right">Messages</TableHead><TableHead>First seen</TableHead><TableHead>Last seen</TableHead></TableRow></TableHeader><TableBody>{rows.map((version) => <TableRow key={`${version.version}-${version.firstSeen}`}><TableCell className="font-mono font-medium">{version.version}</TableCell><TableCell className="text-right font-mono">{formatNumber(version.sessionCount)}</TableCell><TableCell className="text-right font-mono">{formatNumber(version.messageCount)}</TableCell><TableCell><time suppressHydrationWarning dateTime={new Date(version.firstSeen).toISOString()}>{new Date(version.firstSeen).toLocaleDateString()}</time></TableCell><TableCell><time suppressHydrationWarning dateTime={new Date(version.lastSeen).toISOString()}>{new Date(version.lastSeen).toLocaleDateString()}</time></TableCell></TableRow>)}</TableBody></Table></section>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { ThemeProvider, ThemeScript, useTheme } from "@/components/theme-provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StatCard } from "@/components/ui/stat-card";
import { LineChartCard } from "@/components/charts/line-chart-card";
import { BarChartCard } from "@/components/charts/bar-chart-card";
import { AreaChartCard } from "@/components/charts/area-chart-card";
import { DonutChartCard } from "@/components/charts/donut-chart-card";
import { HeatmapGrid, type HeatmapCell } from "@/components/charts/heatmap-grid";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { ChartSkeleton } from "@/components/states/chart-skeleton";
import { TableSkeleton } from "@/components/states/table-skeleton";

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match || match[1] === undefined) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const [rl, gl, bl] = [channel(r), channel(g), channel(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(hexA: string, hexB: string): number | null {
  const rgbA = hexToRgb(hexA);
  const rgbB = hexToRgb(hexB);
  if (!rgbA || !rgbB) return null;
  const lA = relativeLuminance(rgbA);
  const lB = relativeLuminance(rgbB);
  const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

const SEMANTIC_PAIRS: Array<{ label: string; bg: string; fg: string }> = [
  { label: "background / foreground", bg: "--background", fg: "--foreground" },
  { label: "surface / surface-foreground", bg: "--surface", fg: "--surface-foreground" },
  { label: "muted / muted-foreground", bg: "--muted", fg: "--muted-foreground" },
  { label: "accent / accent-foreground", bg: "--accent", fg: "--accent-foreground" },
  { label: "destructive / destructive-foreground", bg: "--destructive", fg: "--destructive-foreground" },
  { label: "success / success-foreground", bg: "--success", fg: "--success-foreground" },
  { label: "warning / warning-foreground", bg: "--warning", fg: "--warning-foreground" },
];

const BORDER_TOKENS = ["--border", "--input"];
const CHART_TOKENS = Array.from({ length: 8 }, (_, i) => `--chart-${i + 1}`);

const ALL_TOKENS = [
  ...SEMANTIC_PAIRS.flatMap((p) => [p.bg, p.fg]),
  ...BORDER_TOKENS,
  ...CHART_TOKENS,
];

function ThemedPanel({ mode }: { mode: "light" | "dark" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!ref.current) return;
    const style = getComputedStyle(ref.current);
    const next: Record<string, string> = {};
    for (const name of ALL_TOKENS) {
      next[name] = style.getPropertyValue(name).trim();
    }
    setValues(next);
  }, []);

  const bg = values["--background"];

  return (
    <div ref={ref} className={`${mode} rounded-lg border border-border bg-background p-6 text-foreground`}>
      <h3 className="mb-4 font-mono text-xs uppercase tracking-wide text-muted-foreground">{mode} theme</h3>

      <div className="mb-6 flex flex-col gap-3">
        {SEMANTIC_PAIRS.map(({ label, bg: bgVar, fg: fgVar }) => {
          const bgHex = values[bgVar];
          const fgHex = values[fgVar];
          const ratio = bgHex && fgHex ? contrastRatio(bgHex, fgHex) : null;
          return (
            <div key={label} className="flex items-center gap-3">
              <div
                className="flex h-12 w-40 shrink-0 items-center justify-center rounded-md border border-border text-xs font-medium"
                style={{ background: bgHex, color: fgHex }}
              >
                Aa
              </div>
              <div className="font-mono text-xs">
                <div>{label}</div>
                <div className="text-muted-foreground">
                  {bgHex} / {fgHex}
                  {ratio !== null && (
                    <span className={ratio >= 3 ? "text-success" : "text-destructive"}> · {ratio.toFixed(2)}:1</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">border / input</div>
      <div className="mb-6 flex gap-3">
        {BORDER_TOKENS.map((varName) => (
          <div
            key={varName}
            className="flex h-10 w-28 items-center justify-center rounded-md font-mono text-xs"
            style={{ border: `2px solid ${values[varName]}` }}
          >
            {varName}
          </div>
        ))}
      </div>

      <div className="mb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
        chart palette (8 hues) — ratio is against this theme&apos;s background
      </div>
      <div className="grid grid-cols-4 gap-2">
        {CHART_TOKENS.map((varName, i) => {
          const hex = values[varName];
          const ratio = hex && bg ? contrastRatio(hex, bg) : null;
          return (
            <div key={varName} className="flex flex-col items-center gap-1">
              <div className="h-10 w-full rounded-md" style={{ background: hex }} />
              <div className="font-mono text-[10px] text-muted-foreground">
                chart-{i + 1}
                {ratio !== null && (
                  <span className={ratio >= 3 ? "text-success" : "text-destructive"}> {ratio.toFixed(2)}:1</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * OCL-003's 17 shadcn primitives, shown once and re-themed by the page's real
 * toggle (ThemeToggleDemo above), rather than duplicated into forced
 * light/dark panels like ThemedPanel — several of these (dialog, popover,
 * select, sheet, tooltip, command) portal their content to <body> via Radix,
 * outside a forced-theme div's subtree, so a static split view wouldn't
 * actually re-theme their portaled content. Toggling the real page theme does.
 */
function PrimitivesShowcase() {
  return (
    <TooltipProvider>
      <div className="space-y-10 rounded-lg border border-border bg-surface p-6 text-surface-foreground">
        <h2 className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
          17 primitives (OCL-003) — toggle the theme above to re-theme this section, including portaled content
        </h2>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Alert</h3>
          <Alert>
            <Info />
            <AlertTitle>Heads up</AlertTitle>
            <AlertDescription>A default alert, using the accent-adjacent border/foreground tokens.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <Info />
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>A destructive alert, using the destructive token pair.</AlertDescription>
          </Alert>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Badge</h3>
          <div className="flex flex-wrap gap-2">
            <Badge>default</Badge>
            <Badge variant="secondary">secondary</Badge>
            <Badge variant="destructive">destructive</Badge>
            <Badge variant="outline">outline</Badge>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Breadcrumb</h3>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Overview</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Sessions</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>crisp-otter</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Button</h3>
          <div className="flex flex-wrap gap-2">
            <Button>default</Button>
            <Button variant="secondary">secondary</Button>
            <Button variant="destructive">destructive</Button>
            <Button variant="outline">outline</Button>
            <Button variant="ghost">ghost</Button>
            <Button variant="link">link</Button>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Card</h3>
          <Card className="max-w-sm">
            <CardHeader>
              <CardTitle>crisp-otter</CardTitle>
              <CardDescription>global · build · deepseek-v4-flash-free</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">7,912 input · 6 output · 15 reasoning tokens.</p>
            </CardContent>
            <CardFooter>
              <Button size="sm">Open replay</Button>
            </CardFooter>
          </Card>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Command</h3>
          <Command className="max-w-sm rounded-md border border-border">
            <CommandInput placeholder="Search sessions or projects..." />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup heading="Sessions">
                <CommandItem>crisp-otter</CommandItem>
                <CommandItem>quiet-falcon</CommandItem>
              </CommandGroup>
              <CommandGroup heading="Projects">
                <CommandItem>global</CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Dialog</h3>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm action</DialogTitle>
                <DialogDescription>This is a dialog rendered via a Radix portal.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline">Cancel</Button>
                <Button>Confirm</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Input</h3>
          <div className="flex max-w-sm flex-col gap-2">
            <Input placeholder="Filter sessions..." />
            <Input placeholder="Disabled" disabled />
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Popover</h3>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">Open popover</Button>
            </PopoverTrigger>
            <PopoverContent>A popover rendered via a Radix portal.</PopoverContent>
          </Popover>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Progress</h3>
          <div className="flex max-w-sm flex-col gap-2">
            <Progress value={33} />
            <Progress value={72} />
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Select</h3>
          <Select defaultValue="build">
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Agent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="build">build</SelectItem>
              <SelectItem value="plan">plan</SelectItem>
              <SelectItem value="unknown">unknown</SelectItem>
            </SelectContent>
          </Select>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Separator</h3>
          <div className="max-w-sm">
            <p className="text-sm">Above</p>
            <Separator className="my-2" />
            <p className="text-sm">Below</p>
            <div className="mt-2 flex h-6 items-center gap-2">
              <span className="text-sm">Left</span>
              <Separator orientation="vertical" />
              <span className="text-sm">Right</span>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Sheet</h3>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Open sheet</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Session filters</SheetTitle>
                <SheetDescription>A sheet rendered via a Radix portal.</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Skeleton</h3>
          <div className="flex max-w-sm flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Table</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>crisp-otter</TableCell>
                <TableCell>build</TableCell>
                <TableCell>7,933</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>quiet-falcon</TableCell>
                <TableCell>plan</TableCell>
                <TableCell>2,104</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Tabs</h3>
          <Tabs defaultValue="overview" className="max-w-sm">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="tools">Tools</TabsTrigger>
              <TabsTrigger value="replay">Replay</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">Overview tab content.</TabsContent>
            <TabsContent value="tools">Tools tab content.</TabsContent>
            <TabsContent value="replay">Replay tab content.</TabsContent>
          </Tabs>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Tooltip</h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Hover me</Button>
            </TooltipTrigger>
            <TooltipContent>A tooltip rendered via a Radix portal.</TooltipContent>
          </Tooltip>
        </section>
      </div>
    </TooltipProvider>
  );
}

const SAMPLE_TIME_SERIES = [
  { date: "Mon", sessions: 4, tokens: 1200 },
  { date: "Tue", sessions: 7, tokens: 2400 },
  { date: "Wed", sessions: 3, tokens: 900 },
  { date: "Thu", sessions: 9, tokens: 3100 },
  { date: "Fri", sessions: 6, tokens: 1800 },
  { date: "Sat", sessions: 2, tokens: 500 },
  { date: "Sun", sessions: 5, tokens: 1600 },
];

const SAMPLE_DONUT = [
  { key: "claude", label: "claude-sonnet-5", value: 42 },
  { key: "deepseek", label: "deepseek-v4", value: 28 },
  { key: "gpt", label: "gpt-5", value: 15 },
  { key: "other", label: "other", value: 8 },
];

/** Deterministic sample values (no Math.random — would mismatch between SSR and client hydration). */
function buildSampleHeatmap(): HeatmapCell[][] {
  const weeks: HeatmapCell[][] = [];
  for (let w = 0; w < 12; w++) {
    const week: HeatmapCell[] = [];
    for (let d = 0; d < 7; d++) {
      const index = w * 7 + d;
      const value = index % 11 === 0 ? 0 : (index * 13) % 9;
      week.push({ label: `Week ${w + 1}, day ${d + 1}`, value });
    }
    weeks.push(week);
  }
  return weeks;
}

/**
 * OCL-021's chart primitives, stat cards, and empty/error/loading states,
 * shown with representative sample data. Re-themed by the page's real toggle
 * (ThemeToggleDemo above), same as PrimitivesShowcase.
 */
function ChartsShowcase() {
  const heatmapWeeks = buildSampleHeatmap();

  return (
    <div className="space-y-10 rounded-lg border border-border bg-surface p-6 text-surface-foreground">
      <h2 className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
        Chart primitives &amp; stat cards (OCL-021)
      </h2>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Sessions"
          value={128}
          delta={{ value: 12, direction: "up", label: "vs last week" }}
          tooltip="Total sessions in range"
        />
        <StatCard label="Tokens" value={482391} subLabel="input + output" />
        <StatCard label="Estimated cost" value="not priced" tooltip="No prices entered yet — see Settings" />
        <StatCard label="Avg session length" value={840} formatValue={(v) => `${Math.round(v / 60)}m`} />
      </section>

      <section className="space-y-3">
        <LineChartCard
          title="Sessions over time"
          data={SAMPLE_TIME_SERIES}
          xKey="date"
          series={[{ key: "sessions", label: "Sessions" }]}
        />
      </section>

      <section className="space-y-3">
        <BarChartCard
          title="Tokens per day"
          data={SAMPLE_TIME_SERIES}
          xKey="date"
          series={[{ key: "tokens", label: "Tokens" }]}
        />
      </section>

      <section className="space-y-3">
        <AreaChartCard
          title="Sessions vs tokens (stacked)"
          data={SAMPLE_TIME_SERIES}
          xKey="date"
          series={[
            { key: "sessions", label: "Sessions" },
            { key: "tokens", label: "Tokens" },
          ]}
        />
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <DonutChartCard title="Model breakdown" data={SAMPLE_DONUT} />
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Activity heatmap</h3>
          <HeatmapGrid weeks={heatmapWeeks} />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Empty / error / loading states</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <LineChartCard title="Empty line chart" data={[]} xKey="date" series={[{ key: "sessions", label: "Sessions" }]} />
          <EmptyState title="No sessions yet" description="Start a session in opencode and refresh." />
          <ErrorState message="Could not reach the opencode database." />
          <ChartSkeleton height={160} />
          <TableSkeleton rows={4} columns={3} />
        </div>
      </section>
    </div>
  );
}

function ThemeToggleDemo() {
  const { theme, toggleTheme, mounted } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
    >
      {mounted ? `Switch to ${theme === "dark" ? "light" : "dark"}` : "Toggle theme"}
    </button>
  );
}

export default function StyleGuidePage() {
  return (
    <ThemeProvider>
      <ThemeScript />
      <main className="min-h-screen bg-background p-8 text-foreground">
        <div className="mx-auto max-w-5xl space-y-8">
          <header className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">oc-lens style guide</h1>
              <p className="text-sm text-muted-foreground">
                Dev-only token reference (OCL-002). Toggle the theme, then hard-reload — it should persist with no
                flash of the wrong theme.
              </p>
            </div>
            <ThemeToggleDemo />
          </header>

          <section className="grid gap-6 md:grid-cols-2">
            <ThemedPanel mode="light" />
            <ThemedPanel mode="dark" />
          </section>

          <PrimitivesShowcase />

          <ChartsShowcase />

          <section className="space-y-1 font-mono text-xs text-muted-foreground">
            <p>Typography: --font-sans for body text; --font-mono (via .font-mono / .tabular-nums) for numerals, costs, token counts, and IDs.</p>
            <p>Radius scale: --radius-sm / --radius-md / --radius-lg / --radius-xl, derived from --radius.</p>
          </section>
        </div>
      </main>
    </ThemeProvider>
  );
}

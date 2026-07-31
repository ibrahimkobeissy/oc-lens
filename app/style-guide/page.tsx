"use client";

import { useEffect, useRef, useState } from "react";
import { ThemeProvider, ThemeScript, useTheme } from "@/components/theme-provider";

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

          <section className="space-y-1 font-mono text-xs text-muted-foreground">
            <p>Typography: --font-sans for body text; --font-mono (via .font-mono / .tabular-nums) for numerals, costs, token counts, and IDs.</p>
            <p>Radius scale: --radius-sm / --radius-md / --radius-lg / --radius-xl, derived from --radius.</p>
          </section>
        </div>
      </main>
    </ThemeProvider>
  );
}

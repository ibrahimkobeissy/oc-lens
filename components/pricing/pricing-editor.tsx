"use client";

import { useMemo, useState } from "react";
import { Copy, Save } from "lucide-react";

import { PricingFeedback, type PricingNotice } from "@/components/pricing/pricing-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTokens } from "@/lib/format";
import type { PricableModel, PricingConfig, PricingModelRate, PricingSettingsResponse } from "@/types/oc";

export const RATE_FIELDS = ["inputPerMTok", "outputPerMTok", "cacheReadPerMTok", "cacheWritePerMTok"] as const;
export type RateField = (typeof RATE_FIELDS)[number];
export type ModelDraft = Record<RateField, string>;
export type PricingDrafts = Record<string, ModelDraft>;

const EMPTY_DRAFT: ModelDraft = { inputPerMTok: "", outputPerMTok: "", cacheReadPerMTok: "", cacheWritePerMTok: "" };

function totalVolume(model: PricableModel): number {
  return model.tokens.input + model.tokens.output + model.tokens.reasoning + model.tokens.cacheRead + model.tokens.cacheWrite;
}

export function sortedModels(data: PricingSettingsResponse): PricableModel[] {
  return [...data.pricableModels].sort((left, right) => {
    const leftPriced = left.key in data.prices;
    const rightPriced = right.key in data.prices;
    if (leftPriced !== rightPriced) return leftPriced ? 1 : -1;
    return totalVolume(right) - totalVolume(left) || left.key.localeCompare(right.key);
  });
}

export function draftsFromPricing(data: PricingSettingsResponse): PricingDrafts {
  return Object.fromEntries(data.pricableModels.map((model) => {
    const rate = data.prices[model.key];
    return [model.key, rate ? {
      inputPerMTok: `${rate.inputPerMTok}`,
      outputPerMTok: `${rate.outputPerMTok}`,
      cacheReadPerMTok: `${rate.cacheReadPerMTok}`,
      cacheWritePerMTok: `${rate.cacheWritePerMTok}`,
    } : { ...EMPTY_DRAFT }];
  }));
}

export function validatePricingDrafts(drafts: PricingDrafts): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, draft] of Object.entries(drafts)) {
    const values = RATE_FIELDS.map((field) => draft[field].trim());
    if (values.every((value) => value === "")) continue;
    if (values.some((value) => value === "")) {
      errors[key] = "Enter all four prices, or clear all four to leave this model unpriced.";
      continue;
    }
    const numbers = values.map(Number);
    if (numbers.some((value) => !Number.isFinite(value) || value < 0)) {
      errors[key] = "Prices must be finite, non-negative numbers.";
      continue;
    }
    if (numbers.every((value) => value === 0)) {
      errors[key] = "Clear all four fields to mark this model unpriced; an all-zero price is not meaningful.";
    }
  }
  return errors;
}

export function configFromDrafts(drafts: PricingDrafts, updatedAt: number): PricingConfig {
  const prices: Record<string, PricingModelRate> = {};
  for (const [key, draft] of Object.entries(drafts)) {
    if (RATE_FIELDS.every((field) => draft[field].trim() === "")) continue;
    prices[key] = {
      inputPerMTok: Number(draft.inputPerMTok), outputPerMTok: Number(draft.outputPerMTok),
      cacheReadPerMTok: Number(draft.cacheReadPerMTok), cacheWritePerMTok: Number(draft.cacheWritePerMTok), currency: "USD",
    };
  }
  return { version: 1, prices, updatedAt };
}

interface PricingEditorProps {
  initial: PricingSettingsResponse;
  onSave: (config: PricingConfig) => Promise<void>;
}

export function PricingEditor({ initial, onSave }: PricingEditorProps) {
  const models = useMemo(() => sortedModels(initial), [initial]);
  const [drafts, setDrafts] = useState<PricingDrafts>(() => draftsFromPricing(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [copySources, setCopySources] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<PricingNotice | null>(null);

  function change(key: string, field: RateField, value: string): void {
    setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? EMPTY_DRAFT), [field]: value } }));
    setErrors((current) => { const next = { ...current }; delete next[key]; return next; });
  }

  function copyPrices(target: string): void {
    const source = copySources[target];
    if (!source || !drafts[source]) return;
    setDrafts((current) => ({ ...current, [target]: { ...current[source]! } }));
    setErrors((current) => { const next = { ...current }; delete next[target]; return next; });
  }

  async function save(): Promise<void> {
    const validation = validatePricingDrafts(drafts);
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      setNotice({ kind: "error", message: "Fix the highlighted model prices before saving." });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await onSave(configFromDrafts(drafts, Date.now()));
      setNotice({ kind: "success", message: "Model prices saved. Cost views are refreshing now." });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Model prices could not be saved." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="max-w-full overflow-x-auto rounded-lg border border-border bg-card shadow-xs">
        <table className="min-w-[1180px] w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="min-w-64 px-3 py-2 font-medium">Provider / model</th><th className="px-3 py-2 font-medium">Observed tokens</th><th className="px-3 py-2 font-medium">Input</th><th className="px-3 py-2 font-medium">Output</th><th className="px-3 py-2 font-medium">Cache read</th><th className="px-3 py-2 font-medium">Cache write</th><th className="min-w-64 px-3 py-2 font-medium">Copy prices</th></tr></thead>
          <tbody className="divide-y divide-border">{models.map((model) => {
            const draft = drafts[model.key] ?? EMPTY_DRAFT;
            const unpriced = RATE_FIELDS.every((field) => draft[field].trim() === "");
            const sources = models.filter((candidate) => candidate.key !== model.key && RATE_FIELDS.every((field) => (drafts[candidate.key]?.[field] ?? "").trim() !== ""));
            return <tr key={model.key} className="align-top">
              <td className="px-3 py-3"><p className="font-medium text-foreground">{model.providerID} / {model.modelID}</p><div className="mt-1">{unpriced ? <Badge variant="outline">not priced</Badge> : <Badge variant="secondary">priced · USD</Badge>}</div>{errors[model.key] && <p id={`price-error-${model.key}`} className="mt-2 max-w-64 text-xs text-destructive">{errors[model.key]}</p>}</td>
              <td className="px-3 py-3"><p className="font-mono font-medium">{formatTokens(totalVolume(model))}</p><p className="mt-1 text-xs text-muted-foreground">In {formatTokens(model.tokens.input)} · Out {formatTokens(model.tokens.output)} · Cache {formatTokens(model.tokens.cacheRead + model.tokens.cacheWrite)}</p></td>
              {RATE_FIELDS.map((field) => <td key={field} className="px-2 py-3"><label className="sr-only" htmlFor={`${model.key}-${field}`}>{model.providerID}/{model.modelID} {field} dollars per million tokens</label><Input id={`${model.key}-${field}`} type="number" inputMode="decimal" min="0" step="any" className="w-28 font-mono" value={draft[field]} aria-invalid={Boolean(errors[model.key])} aria-describedby={errors[model.key] ? `price-error-${model.key}` : undefined} placeholder="—" onChange={(event) => change(model.key, field, event.target.value)} /></td>)}
              <td className="px-3 py-3"><div className="flex gap-2"><select aria-label={`Copy prices to ${model.providerID}/${model.modelID} from`} className="h-9 min-w-40 rounded-md border border-input bg-background px-2 text-sm" value={copySources[model.key] ?? ""} onChange={(event) => setCopySources((current) => ({ ...current, [model.key]: event.target.value }))}><option value="">Choose model…</option>{sources.map((source) => <option key={source.key} value={source.key}>{source.providerID}/{source.modelID}</option>)}</select><Button type="button" variant="outline" size="sm" disabled={!copySources[model.key]} onClick={() => copyPrices(model.key)}><Copy aria-hidden="true" />Copy</Button></div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="flex justify-end"><Button type="button" disabled={saving} onClick={() => void save()}><Save aria-hidden="true" />{saving ? "Saving…" : "Save prices"}</Button></div>
      <PricingFeedback notice={notice} onDismiss={() => setNotice(null)} />
    </>
  );
}

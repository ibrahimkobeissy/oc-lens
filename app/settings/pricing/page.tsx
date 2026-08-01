"use client";

import { CircleDollarSign } from "lucide-react";
import Link from "next/link";
import { useSWRConfig } from "swr";

import { PricingEditor } from "@/components/pricing/pricing-editor";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Onboarding } from "@/components/states/onboarding";
import { SchemaMismatch } from "@/components/states/schema-mismatch";
import { TableSkeleton } from "@/components/states/table-skeleton";
import { WarningsBanner } from "@/components/states/warnings-banner";
import { useOc } from "@/hooks/use-oc";
import { schemaVersion } from "@/lib/db/schema-guard";
import type { OcEnvelope, PricingConfig, PricingSettingsResponse } from "@/types/oc";

interface PutBody {
  data?: PricingConfig;
  error?: { message?: string };
}

export default function PricingSettingsPage() {
  const pricing = useOc("/api/pricing", { polling: false });
  const { mutate: mutateAll } = useSWRConfig();

  async function save(config: PricingConfig): Promise<void> {
    const previous = pricing.data;
    if (!previous) throw new Error("Pricing data is not ready yet.");
    const optimistic: OcEnvelope<PricingSettingsResponse> = {
      data: {
        ...config,
        pricableModels: previous.data.pricableModels.map((model) => ({ ...model, priced: model.key in config.prices })),
      },
      meta: { ...previous.meta, generatedAt: Date.now() },
    };
    await pricing.mutate(optimistic, false);

    try {
      const response = await fetch("/api/pricing", {
        method: "PUT",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(config),
      });
      const body = await response.json() as PutBody;
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "The server rejected the pricing configuration.");
      await pricing.mutate({
        data: {
          ...body.data,
          pricableModels: previous.data.pricableModels.map((model) => ({ ...model, priced: model.key in body.data!.prices })),
        },
        meta: { ...previous.meta, generatedAt: Date.now() },
      }, false);
      await mutateAll(
        (key) => typeof key === "string" && (key.startsWith("/api/stats") || key.startsWith("/api/costs")),
        undefined,
        { revalidate: true },
      );
    } catch (error) {
      await pricing.mutate(previous, false);
      throw error;
    }
  }

  if (pricing.error?.isDatabaseNotFound) return <Onboarding />;
  if (pricing.error?.isSchemaMismatch) return <SchemaMismatch schemaVersion={schemaVersion} message={pricing.error.message} />;

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <header><p className="text-xs text-muted-foreground"><Link href="/settings" className="hover:text-foreground hover:underline">Settings</Link> / Pricing</p><h1 className="mt-1 text-2xl font-semibold text-foreground">Model pricing</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Enter what your provider actually charges in USD per one million tokens. oc-lens never downloads or guesses model prices.</p></header>
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground"><p>Prices are stored locally in <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">~/.config/oc-lens/config.json</code>.</p><p className="mt-1 text-xs text-muted-foreground">Clearing all four fields for a model removes its price and returns every cost view to <strong>not priced</strong>.</p></div>
      {pricing.isLoading && <TableSkeleton rows={7} columns={7} />}
      {pricing.error && !pricing.isLoading && <ErrorState title="Pricing could not be loaded" message={pricing.error.message} onRetry={() => void pricing.mutate()} />}
      {pricing.data && <WarningsBanner warnings={pricing.data.meta.warnings} />}
      {pricing.data && pricing.data.data.pricableModels.length === 0 && <EmptyState icon={<CircleDollarSign />} title="No models observed yet" description="Run an opencode session first. Models appear here only when assistant messages contain real provider and token evidence." />}
      {pricing.data && pricing.data.data.pricableModels.length > 0 && <PricingEditor initial={pricing.data.data} onSave={save} />}
    </div>
  );
}

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PricingEditor, configFromDrafts, draftsFromPricing, sortedModels, validatePricingDrafts, type PricingDrafts } from "./pricing-editor";
import type { PricingSettingsResponse } from "@/types/oc";

function pricing(): PricingSettingsResponse {
  return {
    version: 1,
    updatedAt: 1,
    prices: {
      "provider/priced": { inputPerMTok: 2, outputPerMTok: 3, cacheReadPerMTok: 1, cacheWritePerMTok: 4, currency: "USD" },
    },
    pricableModels: [
      { providerID: "provider", modelID: "priced", key: "provider/priced", tokens: { input: 10, output: 20, reasoning: 0, cacheRead: 5, cacheWrite: 5 }, priced: true },
      { providerID: "provider", modelID: "unpriced-small", key: "provider/unpriced-small", tokens: { input: 100, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, priced: false },
      { providerID: "provider", modelID: "unpriced-large", key: "provider/unpriced-large", tokens: { input: 1_000, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, priced: false },
    ],
  };
}

describe("OCL-090 pricing editor", () => {
  it("sorts unpriced models first by observed volume and renders every model/token class", () => {
    const data = pricing();
    expect(sortedModels(data).map((model) => model.modelID)).toEqual(["unpriced-large", "unpriced-small", "priced"]);
    const html = renderToStaticMarkup(<PricingEditor initial={data} onSave={async () => undefined} />);
    for (const model of data.pricableModels) expect(html).toContain(model.modelID);
    for (const heading of ["Observed tokens", "Input", "Output", "Cache read", "Cache write", "Copy prices"]) expect(html).toContain(heading);
    expect(html).toContain("not priced");
  });

  it("rejects negative, partial, non-finite, and misleading all-zero rows client-side", () => {
    const drafts: PricingDrafts = {
      negative: { inputPerMTok: "-1", outputPerMTok: "2", cacheReadPerMTok: "3", cacheWritePerMTok: "4" },
      partial: { inputPerMTok: "1", outputPerMTok: "", cacheReadPerMTok: "", cacheWritePerMTok: "" },
      infinite: { inputPerMTok: "Infinity", outputPerMTok: "2", cacheReadPerMTok: "3", cacheWritePerMTok: "4" },
      zero: { inputPerMTok: "0", outputPerMTok: "0", cacheReadPerMTok: "0", cacheWritePerMTok: "0" },
      cleared: { inputPerMTok: "", outputPerMTok: "", cacheReadPerMTok: "", cacheWritePerMTok: "" },
    };
    expect(Object.keys(validatePricingDrafts(drafts)).sort()).toEqual(["infinite", "negative", "partial", "zero"]);
  });

  it("round-trips existing prices and clearing all fields removes the model from saved config", () => {
    const data = pricing();
    const drafts = draftsFromPricing(data);
    expect(drafts["provider/priced"]?.outputPerMTok).toBe("3");
    drafts["provider/priced"] = { inputPerMTok: "", outputPerMTok: "", cacheReadPerMTok: "", cacheWritePerMTok: "" };
    const config = configFromDrafts(drafts, 99);
    expect(config).toEqual({ version: 1, prices: {}, updatedAt: 99 });
  });
});

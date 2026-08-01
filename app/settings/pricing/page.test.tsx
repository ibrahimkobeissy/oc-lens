import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OcApiError } from "@/lib/swr";

let error = new OcApiError({ code: "database_not_found", message: "Database missing" }, 404);

vi.mock("@/hooks/use-oc", () => ({
  useOc: () => ({ data: undefined, error, isLoading: false, mutate: vi.fn() }),
}));
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate: vi.fn() }) }));

import PricingSettingsPage from "./page";

describe("OCL-142 pricing page database states", () => {
  it("renders onboarding for a missing database", () => {
    error = new OcApiError({ code: "database_not_found", message: "Database missing" }, 404);
    const markup = renderToStaticMarkup(<PricingSettingsPage />);
    expect(markup).toContain("Database not found");
    expect(markup).not.toContain("No models observed yet");
  });

  it("refuses analytics for a schema mismatch", () => {
    error = new OcApiError({ code: "schema_mismatch", message: "Unsupported schema" }, 409);
    const markup = renderToStaticMarkup(<PricingSettingsPage />);
    expect(markup).toContain("Schema mismatch");
    expect(markup).toContain("Unsupported schema");
    expect(markup).not.toContain("No models observed yet");
  });
});

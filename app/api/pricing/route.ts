import { NextResponse } from "next/server";
import { getConnection } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { PricingValidationError, readPricing, writePricing } from "@/lib/pricing/config";
import { listPricableModels, type PricableModel } from "@/lib/pricing/models";
import type { OcResponse, PricingConfig } from "@/types/oc";

interface PricingRouteData extends PricingConfig {
  pricableModels: PricableModel[];
}

function envelope<T>(data: T): OcResponse<T> {
  return { data, meta: { generatedAt: Date.now(), schemaVersion, warnings: [] } };
}

/**
 * Neither handler below accepts a filesystem path in any form — `readPricing`/
 * `writePricing` are always called with no path override here, so the module
 * constant (honouring `XDG_CONFIG_HOME`) is the only path that's ever used.
 */
export async function GET(): Promise<NextResponse<OcResponse<PricingRouteData>>> {
  const config = readPricing();
  const connectResult = getConnection();
  const pricableModels = connectResult.ok ? listPricableModels(connectResult.db, config) : [];
  return NextResponse.json(envelope({ ...config, pricableModels }));
}

export async function PUT(request: Request): Promise<NextResponse<OcResponse<PricingConfig>>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_body", message: "Body must be valid JSON" } }, { status: 400 });
  }

  try {
    const written = writePricing(body);
    return NextResponse.json(envelope(written));
  } catch (err) {
    if (err instanceof PricingValidationError) {
      return NextResponse.json({ error: { code: "invalid_body", message: err.message } }, { status: 400 });
    }
    throw err;
  }
}

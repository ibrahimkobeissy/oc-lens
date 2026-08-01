import { NextResponse } from "next/server";

import { schemaVersion } from "@/lib/db/schema-guard";
import { getOpencodeHealth } from "@/lib/http/opencode-client";
import type { HealthRouteResponse } from "@/types/oc";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<HealthRouteResponse>> {
  const data = await getOpencodeHealth();
  return NextResponse.json({
    data,
    meta: { generatedAt: Date.now(), schemaVersion, warnings: [] },
  });
}

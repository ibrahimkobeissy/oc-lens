import { NextResponse } from "next/server";

import { locateDb } from "@/lib/db/locate";
import { schemaVersion } from "@/lib/db/schema-guard";
import { computeStorageSizes } from "@/lib/db/storage";
import type { StorageRouteResponse } from "@/types/oc";

export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: number): NextResponse<StorageRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(): Promise<NextResponse<StorageRouteResponse>> {
  const located = locateDb();
  if (!located.found) {
    return errorResponse(
      "database_not_found",
      "No opencode database was found. Check the database location in Settings.",
      404,
    );
  }

  try {
    return NextResponse.json({
      data: computeStorageSizes(located.path),
      meta: { generatedAt: Date.now(), schemaVersion, warnings: [] },
    });
  } catch {
    return errorResponse(
      "storage_unavailable",
      "The opencode storage footprint could not be measured.",
      500,
    );
  }
}

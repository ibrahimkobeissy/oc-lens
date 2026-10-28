const DAY_MS = 86_400_000;
const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type CostsRange = keyof typeof RANGE_DAYS | "all";

export type CostsQuery =
  | { ok: true; range: { from?: number; to?: number }; timeZone: string }
  | { ok: false; code: string; message: string };

function isRange(value: string): value is CostsRange {
  return value === "all" || Object.hasOwn(RANGE_DAYS, value);
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** `?range=7d|30d|90d|all&tz=<IANA>` as the Costs page sends it; `now` anchors the rolling window. */
export function parseCostsQuery(params: URLSearchParams, now: number): CostsQuery {
  const rangeName = params.get("range") ?? "30d";
  const timeZone = params.get("tz") ?? "UTC";
  if (!isRange(rangeName)) return { ok: false, code: "invalid_range", message: "Range must be one of 7d, 30d, 90d, or all." };
  if (!isTimeZone(timeZone)) return { ok: false, code: "invalid_timezone", message: "Timezone must be a valid IANA timezone." };
  const range = rangeName === "all" ? {} : { from: now - RANGE_DAYS[rangeName] * DAY_MS, to: now + 1 };
  return { ok: true, range, timeZone };
}

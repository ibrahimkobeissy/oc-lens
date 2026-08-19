import type { HealthResponse, LiveEndpointHealth } from "@/types/oc";

export const OPENCODE_URL_ENV = "OC_LENS_OPENCODE_URL";
export const OPENCODE_TIMEOUT_ENV = "OC_LENS_OPENCODE_TIMEOUT_MS";
export const DEFAULT_OPENCODE_TIMEOUT_MS = 1_200;
export const MIN_OPENCODE_TIMEOUT_MS = 100;
export const MAX_OPENCODE_TIMEOUT_MS = 1_500;

const KNOWN_STATES = new Set([
  "connected",
  "connecting",
  "disabled",
  "disconnected",
  "error",
  "failed",
  "idle",
  "needs_auth",
  "pending",
  "running",
  "starting",
  "stopped",
]);
const MAX_ITEMS = 100;

type FetchLike = typeof fetch;

export interface OpencodeClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_OPENCODE_TIMEOUT_MS;
  return Math.min(MAX_OPENCODE_TIMEOUT_MS, Math.max(MIN_OPENCODE_TIMEOUT_MS, Math.trunc(value)));
}

function timeoutFromEnvironment(): number {
  const raw = process.env[OPENCODE_TIMEOUT_ENV];
  return boundedTimeout(raw === undefined || raw.trim() === "" ? undefined : Number(raw));
}

function parseBaseUrl(value: string | undefined): URL | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    url.hash = "";
    url.search = "";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    return url;
  } catch {
    return null;
  }
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100);
  return cleaned || null;
}

function safeState(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const normalized = value.toLowerCase().replace(/[ -]/g, "_");
  return KNOWN_STATES.has(normalized) ? normalized : "unknown";
}

function collection(value: unknown): Array<[string | null, unknown]> | null {
  if (Array.isArray(value)) return value.map((entry) => [null, entry]);
  if (!isRecord(value)) return null;
  return Object.entries(value);
}

function summarize(value: unknown, includeItems: boolean): Pick<LiveEndpointHealth, "items" | "itemCount"> {
  const entries = collection(value);
  if (!entries) return { items: [], itemCount: null };
  if (!includeItems) return { items: [], itemCount: entries.length };

  // `itemCount` reports the true collection size (types/oc.ts); only the
  // rendered `items` list is bounded to MAX_ITEMS to cap response payload size.
  const items = entries.slice(0, MAX_ITEMS).flatMap(([key, entry]) => {
    const record = isRecord(entry) ? entry : null;
    const name = cleanName(record?.name ?? record?.id ?? key);
    if (!name) return [];
    return [{ name, status: safeState(record?.status ?? entry) }];
  });
  return { items, itemCount: entries.length };
}

async function getEndpoint(
  clientFetch: FetchLike,
  baseUrl: URL,
  endpoint: "mcp" | "lsp" | "agent" | "config",
  timeoutMs: number,
): Promise<LiveEndpointHealth> {
  try {
    const response = await clientFetch(new URL(endpoint, baseUrl), {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { available: false, items: [], itemCount: null };
    if (endpoint === "agent" || endpoint === "config") {
      // These bodies may contain prompts, commands, environment values, or
      // credentials. Reachability is sufficient; never parse them.
      await response.body?.cancel();
      return { available: true, items: [], itemCount: null };
    }
    const body: unknown = await response.json();
    const details = summarize(body, true);
    return { available: true, ...details };
  } catch {
    return { available: false, items: [], itemCount: null };
  }
}

/**
 * Reads only the four sanctioned GET endpoints and returns a normalized,
 * secret-free summary. In particular, `/config` and `/agent` bodies are never
 * parsed or returned to the browser.
 */
export async function getOpencodeHealth(options: OpencodeClientOptions = {}): Promise<HealthResponse> {
  const baseUrl = parseBaseUrl(options.baseUrl ?? process.env[OPENCODE_URL_ENV]);
  const timeoutMs = boundedTimeout(options.timeoutMs ?? timeoutFromEnvironment());
  const empty = (): LiveEndpointHealth => ({ available: false, items: [], itemCount: null });

  if (!baseUrl) {
    return {
      state: "disabled",
      baseUrl: null,
      timeoutMs,
      checkedAt: Date.now(),
      mcp: empty(), lsp: empty(), agent: empty(), config: empty(),
    };
  }

  const clientFetch = options.fetch ?? fetch;
  const [mcp, lsp, agent, config] = await Promise.all([
    getEndpoint(clientFetch, baseUrl, "mcp", timeoutMs),
    getEndpoint(clientFetch, baseUrl, "lsp", timeoutMs),
    getEndpoint(clientFetch, baseUrl, "agent", timeoutMs),
    getEndpoint(clientFetch, baseUrl, "config", timeoutMs),
  ]);
  const running = mcp.available || lsp.available || agent.available || config.available;
  return {
    state: running ? "running" : "not-running",
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    timeoutMs,
    checkedAt: Date.now(),
    mcp, lsp, agent, config,
  };
}

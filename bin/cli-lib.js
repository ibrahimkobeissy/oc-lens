import { spawn as nodeSpawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const STARTUP_TIMEOUT_MS = 30_000;

/** @typedef {(url: string, init?: RequestInit) => Promise<{ ok: boolean, status: number, json(): Promise<unknown> }>} FetchLike */
/** @typedef {(command: string, args: readonly string[], options: object) => { once(event: string, listener: (error: Error) => void): unknown, unref(): void }} BrowserSpawn */

export class CliUsageError extends Error {}

function optionValue(argv, index, name) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) throw new CliUsageError(`${name} requires a value.`);
  return value;
}

function parsePort(value) {
  if (!/^\d+$/.test(value)) throw new CliUsageError("--port must be an integer from 1 to 65535.");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new CliUsageError("--port must be an integer from 1 to 65535.");
  return port;
}

export function parseArgs(argv) {
  const options = { port: null, noOpen: false, dbPath: null, help: false, version: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--no-open") options.noOpen = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--version" || arg === "-v") options.version = true;
    else if (arg === "--port") { options.port = parsePort(optionValue(argv, index, "--port")); index += 1; }
    else if (arg?.startsWith("--port=")) options.port = parsePort(arg.slice("--port=".length));
    else if (arg === "--db") { options.dbPath = optionValue(argv, index, "--db"); index += 1; }
    else if (arg?.startsWith("--db=")) {
      const value = arg.slice("--db=".length);
      if (!value) throw new CliUsageError("--db requires a value.");
      options.dbPath = value;
    } else throw new CliUsageError(`Unknown argument: ${arg ?? ""}`);
  }
  return options;
}

export function helpText() {
  return `oc-lens — local, read-only opencode analytics

Usage: oc-lens [options]

Options:
  --port <port>  Bind exactly this loopback port (default: first free from 3000)
  --db <path>    Use only this opencode database path
  --no-open      Do not open a browser
  --help, -h     Show this help
  --version, -v  Show the package version`;
}

export function readPackageVersion(packageRoot = PACKAGE_ROOT) {
  try {
    const value = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
    return typeof value.version === "string" ? value.version : "unknown";
  } catch {
    return "unknown";
  }
}

export function isPortAvailable(port, host = LOOPBACK_HOST) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

export async function selectPort(requestedPort, available = isPortAvailable) {
  if (requestedPort !== null) {
    if (await available(requestedPort)) return requestedPort;
    throw new Error(`Port ${requestedPort} is already in use; --port is never auto-incremented.`);
  }
  for (let port = DEFAULT_PORT; port <= 65_535; port += 1) {
    if (await available(port)) return port;
  }
  throw new Error("No free loopback port is available.");
}

export function browserCommand(platform, url) {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "cmd", args: ["/d", "/s", "/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

/** @param {string} url @param {{ platform?: string, spawn?: BrowserSpawn, warn?: (message: string) => void }} [options] */
export function openBrowser(url, { platform = process.platform, spawn = nodeSpawn, warn = console.warn } = {}) {
  const invocation = browserCommand(platform, url);
  const child = spawn(invocation.command, invocation.args, { detached: true, stdio: "ignore", windowsHide: true });
  child.once("error", (error) => warn(`[oc-lens] Browser could not be opened: ${error.message}`));
  child.unref();
}

export function standaloneServerPath(packageRoot = PACKAGE_ROOT) {
  return path.join(packageRoot, ".next", "standalone", "server.js");
}

/** @param {{ packageRoot?: string, port: number, dbPath?: string | null, env?: NodeJS.ProcessEnv }} input */
export function serverSpawnOptions({ packageRoot = PACKAGE_ROOT, port, dbPath = null, env = process.env }) {
  const serverPath = standaloneServerPath(packageRoot);
  return {
    serverPath,
    options: {
      cwd: path.dirname(serverPath),
      env: {
        ...env,
        PORT: String(port),
        HOSTNAME: LOOPBACK_HOST,
        NODE_ENV: "production",
        ...(dbPath === null ? {} : { OC_LENS_DB: path.resolve(dbPath) }),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** @param {string} url @param {import("node:child_process").ChildProcess} child @param {{ fetchImpl?: FetchLike, timeoutMs?: number, intervalMs?: number }} [options] */
export async function waitForServer(url, child, { fetchImpl = fetch, timeoutMs = STARTUP_TIMEOUT_MS, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let spawnError = null;
  child.once("error", (error) => { spawnError = error; });
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Standalone server exited before becoming ready (code ${child.exitCode}).`);
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(Math.min(1_000, Math.max(1, deadline - Date.now()))) });
      if (response.status < 500) return;
    } catch {
      // Expected while the loopback server is still binding.
    }
    await delay(intervalMs);
  }
  throw new Error(`Standalone server did not become ready within ${Math.round(timeoutMs / 1_000)} seconds.`);
}

function safeEnvelopeData(value) {
  return typeof value === "object" && value !== null && "data" in value && typeof value.data === "object" && value.data !== null ? value.data : null;
}

/** @param {string} url @param {FetchLike} [fetchImpl] */
export async function readStartupMetadata(url, fetchImpl = fetch) {
  let dbPath = null;
  let schemaVersion = "unknown";
  let sessionCount = null;
  try {
    const response = await fetchImpl(`${url}/api/settings`);
    if (response.ok) {
      const data = safeEnvelopeData(await response.json());
      if (data && (typeof data.dbPath === "string" || data.dbPath === null)) dbPath = data.dbPath;
      if (data && typeof data.schemaVersion === "string") schemaVersion = data.schemaVersion;
    }
  } catch {
    // Startup remains useful even when optional metadata cannot be read.
  }
  try {
    const response = await fetchImpl(`${url}/api/stats?range=all&tz=UTC`);
    if (response.ok) {
      const data = safeEnvelopeData(await response.json());
      if (data && typeof data.totalSessions === "number" && Number.isFinite(data.totalSessions)) sessionCount = data.totalSessions;
    }
  } catch {
    // A missing or incompatible DB is rendered by the app and reported below.
  }
  return { dbPath, schemaVersion, sessionCount };
}

export function startupLines(url, metadata) {
  return [
    `[oc-lens] Ready: ${url}`,
    `[oc-lens] Database: ${metadata.dbPath ?? "not found"}`,
    `[oc-lens] Schema: ${metadata.schemaVersion}`,
    `[oc-lens] Sessions: ${metadata.sessionCount ?? "unavailable"}`,
  ];
}

function attachLogForwarding(child) {
  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
}

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: null });
  return new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
}

export async function runServer(options, { packageRoot = PACKAGE_ROOT, spawn = nodeSpawn, fetchImpl = fetch } = {}) {
  const port = await selectPort(options.port);
  const url = `http://${LOOPBACK_HOST}:${port}`;
  const { serverPath, options: spawnOptions } = serverSpawnOptions({ packageRoot, port, dbPath: options.dbPath });
  let child;
  try {
    child = spawn(process.execPath, [serverPath], spawnOptions);
  } catch (error) {
    throw new Error(`Could not start the standalone server: ${error instanceof Error ? error.message : String(error)}`);
  }
  attachLogForwarding(child);

  let receivedSignal = null;
  const stop = (signal) => {
    receivedSignal = signal;
    if (child.exitCode === null) child.kill(signal);
  };
  const onSigint = () => stop("SIGINT");
  const onSigterm = () => stop("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    try {
      await waitForServer(url, child, { fetchImpl });
    } catch (error) {
      if (child.exitCode === null) child.kill("SIGTERM");
      throw error;
    }
    const metadata = await readStartupMetadata(url, fetchImpl);
    for (const line of startupLines(url, metadata)) console.log(line);
    if (!options.noOpen) openBrowser(url);
    const result = await waitForExit(child);
    if (receivedSignal === "SIGINT") return 130;
    if (receivedSignal === "SIGTERM") return 143;
    return result.code ?? 1;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(`[oc-lens] ${error.message}\n\n${helpText()}`);
      return 2;
    }
    throw error;
  }
  if (options.help) { console.log(helpText()); return 0; }
  if (options.version) { console.log(readPackageVersion()); return 0; }
  return runServer(options);
}

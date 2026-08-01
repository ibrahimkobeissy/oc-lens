#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const allowedRootEntries = new Set([
  ".next",
  "LICENSE",
  "README.md",
  "bin",
  "package.json",
]);
const forbiddenSourceDirectories = new Set([
  ".agents",
  ".claude",
  ".github",
  "app",
  "components",
  "lib",
  "project-docs",
  "test",
  "tests",
  "types",
]);
const forbiddenBasenames = [
  /^\.env(?:\..+)?$/i,
  /^(?:auth|account)\.json$/i,
  /^(?:AGENTS\.md|\.netrc|\.npmrc|\.pypirc|\.pgpass|\.my\.cnf|\.vault-token)$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /(?:service[-_ ]?account|credentials?).*\.json$/i,
  /^secrets?(?:\..+)?$/i,
  /\.secret$/i,
  /\.tfstate(?:\..+)?$/i,
  /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm))?$/i,
  /\.(?:pem|key|p12|pfx|jks|keystore)$/i,
];
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bnpm_[A-Za-z0-9]{30,}\b/,
  /\bsk-(?:real|project)\b/,
];

export function isForbiddenPackageBasename(basename) {
  return forbiddenBasenames.some((pattern) => pattern.test(basename));
}

export function isForbiddenSourceDirectory(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  const basename = normalized.split("/").at(-1) ?? "";
  const isPackagedDependency = normalized.includes("/node_modules/") || normalized.startsWith(".next/standalone/node_modules/");
  const isCompiledNextRuntime = normalized.startsWith(".next/standalone/.next/");
  return !isPackagedDependency && !isCompiledNextRuntime && forbiddenSourceDirectories.has(basename);
}

export function scanPackage(packageRoot) {
  const findings = [];

  function inspect(entryPath, relativePath) {
    const info = lstatSync(entryPath, { throwIfNoEntry: true });
    const segments = relativePath.split(path.sep);
    const basename = segments.at(-1) ?? "";

    if (segments.length === 1 && !allowedRootEntries.has(basename)) findings.push(`unexpected root entry: ${relativePath}`);
    if (isForbiddenPackageBasename(basename)) findings.push(`forbidden file: ${relativePath}`);
    if (info.isSymbolicLink()) {
      findings.push(`symbolic link: ${relativePath}`);
      return;
    }

    if (info.isDirectory()) {
      if (isForbiddenSourceDirectory(relativePath)) findings.push(`forbidden source directory: ${relativePath}`);
      for (const child of readdirSync(entryPath)) inspect(path.join(entryPath, child), path.join(relativePath, child));
      return;
    }
    if (!info.isFile() || info.size > 5_000_000) return;

    const content = readFileSync(entryPath);
    if (content.includes(0)) return;
    const text = content.toString("utf8");
    for (const pattern of secretPatterns) {
      if (pattern.test(text)) findings.push(`secret-like content in: ${relativePath}`);
    }
  }

  for (const entry of readdirSync(packageRoot)) inspect(path.join(packageRoot, entry), entry);
  return [...new Set(findings)];
}

function main(argument) {
  if (!argument) {
    console.error("Usage: scan-package.mjs <unpacked-package-root>");
    return 2;
  }
  const packageRoot = path.resolve(argument);
  if (!existsSync(packageRoot)) {
    console.error(`Package root does not exist: ${packageRoot}`);
    return 2;
  }
  const findings = scanPackage(packageRoot);
  if (findings.length > 0) {
    process.stderr.write("Package scan failed:\n" + findings.map((finding) => `- ${finding}`).join("\n") + "\n");
    return 1;
  }
  console.log("Package scan passed: no forbidden source, database, credential, or secret-like content found.");
  return 0;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv[2]);
}

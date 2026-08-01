#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function replaceDirectory(source, destination) {
  if (!existsSync(source)) return false;
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, force: true });
  return true;
}

export function prepareStandalone(packageRoot = PACKAGE_ROOT) {
  const standalone = path.join(packageRoot, ".next", "standalone");
  if (!existsSync(standalone)) throw new Error(".next/standalone was not produced; run a Next build with output: 'standalone'.");
  replaceDirectory(path.join(packageRoot, ".next", "static"), path.join(standalone, ".next", "static"));
  replaceDirectory(path.join(packageRoot, "public"), path.join(standalone, "public"));
  return standalone;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    console.log(`[oc-lens] Standalone bundle prepared at ${prepareStandalone()}`);
  } catch (error) {
    console.error(`[oc-lens] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

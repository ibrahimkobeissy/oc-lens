#!/usr/bin/env node

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { isForbiddenPackageBasename, isForbiddenSourceDirectory, scanPackage } from "./scan-package.mjs";
const root = mkdtempSync(path.join(tmpdir(), "oc-lens-package-scan-"));

function file(relativePath, content = "safe") {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

try {
  file("package.json", "{}");
  file("bin/cli.js");
  file(".next/standalone/.next/server/app/page.js");
  file(".next/standalone/node_modules/example/test/fixture.json", "{}");
  const positive = scanPackage(root);
  if (positive.length > 0) throw new Error(`Positive package scan failed:\n${positive.join("\n")}`);

  file("bin/copied-source/project-docs/backlog.md");
  const negative = scanPackage(root);
  if (negative.length === 0) throw new Error("Negative package scan unexpectedly passed");
  for (const expected of ["forbidden source directory", "project-docs"]) {
    if (!negative.some((finding) => finding.includes(expected))) throw new Error(`Negative package scan did not report ${expected}:\n${negative.join("\n")}`);
  }
  for (const basename of ["service-account-prod.json", "service_account.json", "deployment-credential.json", "deployment-credentials.json", ".netrc", "secrets.yaml", "app.secret", "terraform.tfstate.backup"]) {
    if (!isForbiddenPackageBasename(basename)) throw new Error(`Forbidden basename was accepted: ${basename}`);
  }
  if (!isForbiddenSourceDirectory("bin/copied-source/project-docs")) throw new Error("Nested source directory was accepted");
  if (isForbiddenSourceDirectory(".next/standalone/node_modules/example/test")) throw new Error("Dependency test directory was rejected");
  if (isForbiddenSourceDirectory(".next/standalone/.next/server/app")) throw new Error("Compiled Next app directory was rejected");

  console.log("Package scanner positive and negative checks passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}

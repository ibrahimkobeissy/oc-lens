#!/usr/bin/env node

import { main } from "./cli-lib.js";

main().then(
  (code) => { process.exitCode = code; },
  (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[oc-lens] ${message}`);
    process.exitCode = 1;
  },
);

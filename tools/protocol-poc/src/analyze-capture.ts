#!/usr/bin/env node
import { analyzeCaptureFile, findLatestPrivateCapture } from "./capture-analysis.js";

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input || input === "--help" || input === "-h") {
    printUsage();
    process.exitCode = input ? 0 : 1;
    return;
  }

  const filePath = input === "--latest" ? await findLatestPrivateCapture() : input;
  const analysis = await analyzeCaptureFile(filePath);
  console.log(JSON.stringify(analysis, null, 2));
}

function printUsage(): void {
  console.error("Usage: npm run analyze -- <capture.jsonl>");
  console.error("       npm run analyze -- --latest");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Analysis failed: ${message}`);
  process.exitCode = 1;
});

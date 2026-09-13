#!/usr/bin/env node
import { analyzeLatestPrivateMapFormat, analyzeMapFormat } from "./map-format-analysis.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const input = args[0];
  if (!input || input === "--help" || input === "-h") {
    printUsage();
    process.exitCode = input ? 0 : 1;
    return;
  }

  const analysis = input === "--latest"
    ? await analyzeLatestPrivateMapFormat()
    : await analyzeMapFormat({ capturePath: input });
  console.log(JSON.stringify(analysis, null, 2));
}

function printUsage(): void {
  console.error("Usage: npm run analyze-map-format -- <capture.jsonl>");
  console.error("       npm run analyze-map-format -- --latest");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Map format analysis failed: ${message}`);
  process.exitCode = 1;
});

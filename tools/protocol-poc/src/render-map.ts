#!/usr/bin/env node
import { renderLatestPrivateMap, renderMapFromPrivateCapture } from "./map-renderer.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const input = args[0];
  if (!input || input === "--help" || input === "-h") {
    printUsage();
    process.exitCode = input ? 0 : 1;
    return;
  }

  const options = parseOptions(args.slice(1));
  const result = input === "--latest"
    ? await renderLatestPrivateMap()
    : await renderMapFromPrivateCapture({
        capturePath: input,
        outputDirectory: options.outputDirectory,
        eventIndex: options.eventIndex,
      });

  console.log(JSON.stringify(result, null, 2));
}

function parseOptions(args: string[]): { outputDirectory?: string; eventIndex?: number } {
  const options: { outputDirectory?: string; eventIndex?: number } = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--out") {
      options.outputDirectory = args[++index];
      continue;
    }
    if (arg === "--event") {
      const value = Number(args[++index]);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("--event must be a non-negative integer");
      }
      options.eventIndex = value;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function printUsage(): void {
  console.error("Usage: npm run render-map -- <capture.jsonl> [--event <index>] [--out <private-dir>]");
  console.error("       npm run render-map -- --latest");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Map rendering failed: ${message}`);
  process.exitCode = 1;
});

#!/usr/bin/env node
import { buildCommandRequest, isCommandName, type CommandName } from "./commands.js";
import { ProscenicCommandClient, type Region } from "./client.js";
import { promptHidden, promptLine } from "./input.js";

const DEFAULT_TIMEOUT_MS = 10_000;

interface CliOptions {
  command?: CommandName;
  confirm: boolean;
  deviceIndex: number;
  help: boolean;
}

async function main(): Promise<void> {
  const cli = parseCliOptions(process.argv.slice(2));
  if (cli.help || !cli.command) {
    printUsage();
    return;
  }

  const email = process.env.PROSCENIC_EMAIL || await promptLine("Proscenic account e-mail: ");
  const password = process.env.PROSCENIC_PASSWORD || await promptHidden("Proscenic password: ");
  const region = parseRegion(process.env.PROSCENIC_REGION ?? "eu");
  const timeoutMs = parsePositiveInt(process.env.PROSCENIC_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  const client = new ProscenicCommandClient({ email, password, region, timeoutMs });

  console.log("Login: starting");
  const token = await client.login();
  console.log("Login: success, token received: true");

  const devices = await client.listDevices();
  console.log(`Devices: ${devices.length}`);
  if (devices.length === 0) {
    throw new Error("No devices returned by legacy cloud");
  }

  const device = devices[cli.deviceIndex];
  if (!device) {
    throw new Error(`Device index ${cli.deviceIndex} is outside returned device list`);
  }
  if (!device.sn) {
    throw new Error("Selected device has no serial field");
  }

  console.log("Selected device:", JSON.stringify({
    index: cli.deviceIndex,
    code: device.code ?? null,
    model: device.model ?? null,
    status: device.status ?? null,
  }));

  const request = buildCommandRequest(cli.command, device.sn, email);
  console.log("Command candidate:", JSON.stringify({
    command: cli.command,
    confirmed: cli.confirm,
  }));

  if (!cli.confirm) {
    console.log("Dry run: command was not sent. Add --confirm to send exactly this command.");
    return;
  }

  console.log("Command send: starting");
  const result = await client.sendCommand(token, request.path, request.body);
  console.log("Command send: completed", JSON.stringify({
    code: result.code ?? null,
    success: result.code === undefined || result.code === 0,
    message: result.msg || result.errorMsg || null,
  }));
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    confirm: false,
    deviceIndex: parseNonNegativeInt(process.env.PROSCENIC_DEVICE_INDEX, 0),
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--command": {
        const value = args[index + 1];
        if (!value || !isCommandName(value)) {
          throw new Error(`Expected command: start, pause, continue, or return`);
        }
        options.command = value;
        index += 1;
        break;
      }
      case "--confirm":
        options.confirm = true;
        break;
      case "--device-index": {
        options.deviceIndex = parseNonNegativeInt(args[index + 1], options.deviceIndex);
        index += 1;
        break;
      }
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseRegion(value: string): Region {
  if (value === "eu") {
    return value;
  }

  throw new Error(`Unsupported region ${value}`);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer, got ${value}`);
  }

  return parsed;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Expected non-negative integer, got ${value}`);
  }

  return parsed;
}

function printUsage(): void {
  console.log(`Usage: npm start -- --command <start|pause|continue|return> [--confirm]

Environment:
  PROSCENIC_EMAIL          Proscenic account e-mail
  PROSCENIC_PASSWORD       Proscenic password; if unset, prompts without echo
  PROSCENIC_REGION         Region, currently only "eu" (default)
  PROSCENIC_DEVICE_INDEX   Device index from account device list (default: 0)
  PROSCENIC_TIMEOUT_MS     HTTPS timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})

Safety:
  Without --confirm this tool performs login and device selection only, then exits.
  With --confirm it sends exactly one command candidate to the selected device.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

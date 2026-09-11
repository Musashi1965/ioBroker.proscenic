#!/usr/bin/env node
import { ProscenicClient, type Region } from "./client.js";
import { readGatewayEvents, type GatewayEndpoint, type GatewayEvent } from "./gateway.js";
import { promptHidden, promptLine } from "./input.js";
import { createPrivateCaptureWriter } from "./private-capture.js";
import { summarizeObjectShape } from "./redaction.js";
import { extractSafeStatus20001Values, summarizeStatus20001 } from "./status-candidates.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_LISTEN_SECONDS = 30;
const DEFAULT_MAX_EVENTS = 3;
const DEFAULT_RECONNECT_DELAY_MS = 2_000;
const MAX_BUFFER_BYTES = 512 * 1024;

async function main(): Promise<void> {
  const email = process.env.PROSCENIC_EMAIL || await promptLine("Proscenic account e-mail: ");
  const password = process.env.PROSCENIC_PASSWORD || await promptHidden("Proscenic password: ");
  const region = parseRegion(process.env.PROSCENIC_REGION ?? "eu");
  const timeoutMs = parsePositiveInt(process.env.PROSCENIC_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const listenSeconds = parsePositiveInt(process.env.PROSCENIC_LISTEN_SECONDS, DEFAULT_LISTEN_SECONDS);
  const maxEvents = parsePositiveInt(process.env.PROSCENIC_MAX_EVENTS, DEFAULT_MAX_EVENTS);
  const captureSeconds = parseOptionalPositiveInt(process.env.PROSCENIC_CAPTURE_SECONDS);
  const reconnectDelayMs = parseNonNegativeInt(
    process.env.PROSCENIC_RECONNECT_DELAY_MS,
    DEFAULT_RECONNECT_DELAY_MS,
  );
  const deviceIndex = parseNonNegativeInt(process.env.PROSCENIC_DEVICE_INDEX, 0);
  const printSafeStatusValues = parseBooleanFlag(process.env.PROSCENIC_PRINT_SAFE_STATUS_VALUES);
  const privateCapture = await createPrivateCaptureWriter(parseBooleanFlag(process.env.PROSCENIC_PRIVATE_CAPTURE));
  if (privateCapture) {
    console.log("Private capture: enabled, ignored local file created");
  }

  const client = new ProscenicClient({ email, password, region, timeoutMs });

  console.log("Login: starting");
  const token = await client.login();
  console.log("Login: success, token received: true");

  const devices = await client.listDevices();
  console.log(`Devices: ${devices.length}`);
  if (devices.length === 0) {
    throw new Error("No devices returned by legacy cloud");
  }

  const device = devices[deviceIndex];
  if (!device) {
    throw new Error(`Device index ${deviceIndex} is outside returned device list`);
  }
  if (!device.sn) {
    throw new Error("Selected device has no serial field");
  }

  console.log("Selected device:", JSON.stringify({
    index: deviceIndex,
    code: device.code ?? null,
    model: device.model ?? null,
    status: device.status ?? null,
  }));

  const captureResult = await readGatewayCapture({
    client,
    initialToken: token,
    serial: device.sn,
    listenSeconds,
    captureSeconds,
    maxEvents,
    timeoutMs,
    reconnectDelayMs,
    privateCapture,
    printSafeStatusValues,
  });

  console.log(`Gateway events: ${captureResult.events.length}`);
  console.log(`Gateway frame errors: ${captureResult.frameErrors.length}`);
  console.log("Gateway completion:", JSON.stringify({
    reason: captureResult.completionReason,
    elapsedMs: captureResult.elapsedMs,
    listenSeconds,
    captureSeconds: captureSeconds ?? null,
    cycles: captureResult.cycles,
  }));
  if (privateCapture) {
    await privateCapture.write({
      kind: "run",
      createdAt: new Date().toISOString(),
      device: {
        index: deviceIndex,
        code: device.code ?? null,
        model: device.model ?? null,
        status: device.status ?? null,
      },
      gatewayCompletion: {
        reason: captureResult.completionReason,
        elapsedMs: captureResult.elapsedMs,
        listenSeconds,
        captureSeconds: captureSeconds ?? null,
        cycles: captureResult.cycles,
      },
      eventCount: captureResult.events.length,
      frameErrorCount: captureResult.frameErrors.length,
    });
  }

  if (privateCapture) {
    await privateCapture.close();
  }
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

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
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

function parseBooleanFlag(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function selectGatewayEndpoints(addresses: unknown): GatewayEndpoint[] {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error("No gateway endpoint returned");
  }

  return addresses.map((entry, index) => {
    const candidate = entry as { ip?: unknown; port?: unknown };
    if (typeof candidate.ip !== "string" || candidate.ip.length === 0) {
      throw new Error(`Gateway endpoint ${index + 1} has no host`);
    }

    const port = typeof candidate.port === "number"
      ? candidate.port
      : Number.parseInt(String(candidate.port), 10);

    if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Gateway endpoint ${index + 1} has invalid port`);
    }

    return {
      host: candidate.ip,
      port,
    };
  });
}

async function readGatewayEndpoints(options: {
  endpoints: GatewayEndpoint[];
  token: string;
  tokenCandidates?: string[];
  serial: string;
  listenSeconds: number;
  maxEvents: number;
  timeoutMs: number;
  maxBufferBytes: number;
}): ReturnType<typeof readGatewayEvents> {
  let lastResult: Awaited<ReturnType<typeof readGatewayEvents>> | undefined;

  for (const [index, endpoint] of options.endpoints.entries()) {
    console.log("Gateway attempt:", JSON.stringify({
      index: index + 1,
      total: options.endpoints.length,
    }));
    const result = await readGatewayEvents({
      endpoint,
      token: options.token,
      tokenCandidates: options.tokenCandidates,
      serial: options.serial,
      listenSeconds: options.listenSeconds,
      maxEvents: options.maxEvents,
      timeoutMs: options.timeoutMs,
      maxBufferBytes: options.maxBufferBytes,
    });
    console.log("Gateway attempt completion:", JSON.stringify({
      index: index + 1,
      reason: result.completionReason,
      elapsedMs: result.elapsedMs,
      events: result.events.length,
      frameErrors: result.frameErrors.length,
    }));

    lastResult = result;
    if (result.events.length > 0 || result.completionReason !== "socket-closed") {
      return result;
    }
  }

  if (!lastResult) {
    throw new Error("No gateway endpoints tried");
  }

  return lastResult;
}

async function readGatewayCapture(options: {
  client: ProscenicClient;
  initialToken: string;
  serial: string;
  listenSeconds: number;
  captureSeconds: number | undefined;
  maxEvents: number;
  timeoutMs: number;
  reconnectDelayMs: number;
  privateCapture: Awaited<ReturnType<typeof createPrivateCaptureWriter>>;
  printSafeStatusValues: boolean;
}): Promise<{
  events: Awaited<ReturnType<typeof readGatewayEvents>>["events"];
  frameErrors: Awaited<ReturnType<typeof readGatewayEvents>>["frameErrors"];
  completionReason: string;
  elapsedMs: number;
  cycles: number;
}> {
  const startedAt = Date.now();
  const deadlineMs = options.captureSeconds === undefined
    ? startedAt + options.listenSeconds * 1000
    : startedAt + options.captureSeconds * 1000;
  const events: Awaited<ReturnType<typeof readGatewayEvents>>["events"] = [];
  const frameErrors: Awaited<ReturnType<typeof readGatewayEvents>>["frameErrors"] = [];
  let token = options.initialToken;
  const tokenHistory = [token];
  let cycles = 0;
  let lastCompletionReason = "not-started";

  while (Date.now() < deadlineMs && events.length < options.maxEvents) {
    cycles += 1;
    if (cycles > 1) {
      console.log("Login: refreshing token for capture cycle");
      token = await options.client.login();
      tokenHistory.unshift(token);
      tokenHistory.splice(4);
      console.log("Login: success, token received: true");
    }

    const gateway = await options.client.getGateway(token, options.serial);
    const endpoints = selectGatewayEndpoints(gateway.addr_list);
    console.log("Gateway: endpoints received and validated:", endpoints.length);
    console.log("Gateway capture cycle:", JSON.stringify({
      cycle: cycles,
      elapsedMs: Date.now() - startedAt,
      remainingMs: Math.max(0, deadlineMs - Date.now()),
      events: events.length,
      tokenCandidates: tokenHistory.length,
    }));

    const remainingSeconds = Math.max(1, Math.ceil((deadlineMs - Date.now()) / 1000));
    const result = await readGatewayEndpoints({
      endpoints,
      token,
      tokenCandidates: tokenHistory,
      serial: options.serial,
      listenSeconds: Math.min(options.listenSeconds, remainingSeconds),
      maxEvents: options.maxEvents - events.length,
      timeoutMs: options.timeoutMs,
      maxBufferBytes: MAX_BUFFER_BYTES,
    });
    lastCompletionReason = result.completionReason;

    for (const event of result.events) {
      events.push(event);
      await printGatewayEvent(events.length, event, options.printSafeStatusValues, options.privateCapture);
    }
    for (const frameError of result.frameErrors) {
      frameErrors.push(frameError);
      await printGatewayFrameError(frameErrors.length, frameError, options.privateCapture);
    }

    if (events.length >= options.maxEvents) {
      return {
        events,
        frameErrors,
        completionReason: "max-events-reached",
        elapsedMs: Date.now() - startedAt,
        cycles,
      };
    }

    if (options.captureSeconds === undefined || result.completionReason === "listen-window-elapsed") {
      break;
    }

    const delayMs = Math.min(options.reconnectDelayMs, Math.max(0, deadlineMs - Date.now()));
    if (delayMs > 0) {
      console.log("Gateway reconnect delay:", JSON.stringify({ delayMs }));
      await delay(delayMs);
    }
  }

  return {
    events,
    frameErrors,
    completionReason: Date.now() >= deadlineMs ? "capture-window-elapsed" : lastCompletionReason,
    elapsedMs: Date.now() - startedAt,
    cycles,
  };
}

async function printGatewayEvent(
  index: number,
  event: GatewayEvent,
  printSafeStatusValues: boolean,
  privateCapture: Awaited<ReturnType<typeof createPrivateCaptureWriter>>,
): Promise<void> {
  console.log(`Event ${index}:`, JSON.stringify({
    encrypted: event.encrypted,
    infoType: event.infoType ?? null,
    dataShape: summarizeObjectShape(event.decrypted?.data),
  }));

  if (event.infoType === 20001) {
    const statusSummary = summarizeStatus20001(event.decrypted?.data);
    if (statusSummary) {
      console.log("Status 20001 candidates:", JSON.stringify({
        observedFields: statusSummary.observedCandidateFields.map((candidate) => ({
          upstreamField: candidate.upstreamField,
          candidateStateId: candidate.candidateStateId,
          valueType: candidate.valueType,
          role: candidate.candidateRole,
          unit: candidate.unit ?? null,
          confidence: candidate.confidence,
        })),
        unknownFields: statusSummary.unknownFields,
      }));
    }

    if (printSafeStatusValues) {
      console.log("Status 20001 safe values:", JSON.stringify(extractSafeStatus20001Values(event.decrypted?.data)));
    }
  }

  if (privateCapture) {
    await privateCapture.write({
      kind: "event",
      index,
      encrypted: event.encrypted,
      infoType: event.infoType ?? null,
      decrypted: event.decrypted ?? null,
    });
  }
}

async function printGatewayFrameError(
  index: number,
  frameError: Awaited<ReturnType<typeof readGatewayEvents>>["frameErrors"][number],
  privateCapture: Awaited<ReturnType<typeof createPrivateCaptureWriter>>,
): Promise<void> {
  console.log(`Frame error ${index}:`, JSON.stringify({
    message: frameError.message,
  }));

  if (privateCapture) {
    await privateCapture.write({
      kind: "frame-error",
      index,
      message: frameError.message,
    });
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`PoC failed: ${message}`);
  process.exitCode = 1;
});

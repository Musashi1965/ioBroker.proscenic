#!/usr/bin/env node
import { ProscenicClient, type Region } from "./client.js";
import { readGatewayEvents, type GatewayEndpoint } from "./gateway.js";
import { promptHidden, promptLine } from "./input.js";
import { summarizeObjectShape } from "./redaction.js";
import { summarizeStatus20001 } from "./status-candidates.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_LISTEN_SECONDS = 30;
const DEFAULT_MAX_EVENTS = 3;
const MAX_BUFFER_BYTES = 512 * 1024;

async function main(): Promise<void> {
  const email = process.env.PROSCENIC_EMAIL || await promptLine("Proscenic account e-mail: ");
  const password = process.env.PROSCENIC_PASSWORD || await promptHidden("Proscenic password: ");
  const region = parseRegion(process.env.PROSCENIC_REGION ?? "eu");
  const timeoutMs = parsePositiveInt(process.env.PROSCENIC_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const listenSeconds = parsePositiveInt(process.env.PROSCENIC_LISTEN_SECONDS, DEFAULT_LISTEN_SECONDS);
  const maxEvents = parsePositiveInt(process.env.PROSCENIC_MAX_EVENTS, DEFAULT_MAX_EVENTS);
  const deviceIndex = parseNonNegativeInt(process.env.PROSCENIC_DEVICE_INDEX, 0);

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

  const gateway = await client.getGateway(token, device.sn);
  const endpoint = selectGatewayEndpoint(gateway.addr_list);
  console.log("Gateway: endpoint received and validated: true");

  const events = await readGatewayEvents({
    endpoint,
    token,
    serial: device.sn,
    listenSeconds,
    maxEvents,
    timeoutMs,
    maxBufferBytes: MAX_BUFFER_BYTES,
  });

  console.log(`Gateway events: ${events.length}`);
  for (const [index, event] of events.entries()) {
    console.log(`Event ${index + 1}:`, JSON.stringify({
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
    }
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

function selectGatewayEndpoint(addresses: unknown): GatewayEndpoint {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error("No gateway endpoint returned");
  }

  const candidate = addresses[0] as { ip?: unknown; port?: unknown };
  if (typeof candidate.ip !== "string" || candidate.ip.length === 0) {
    throw new Error("Gateway endpoint has no host");
  }

  const port = typeof candidate.port === "number"
    ? candidate.port
    : Number.parseInt(String(candidate.port), 10);

  if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) {
    throw new Error("Gateway endpoint has invalid port");
  }

  return {
    host: candidate.ip,
    port,
  };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`PoC failed: ${message}`);
  process.exitCode = 1;
});

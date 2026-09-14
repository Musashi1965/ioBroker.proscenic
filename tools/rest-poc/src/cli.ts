#!/usr/bin/env node
import { ProscenicRestProbeClient, type Region } from "./client.js";
import { filterEndpointCandidates, type EndpointCandidate } from "./endpoints.js";
import { promptHidden, promptLine } from "./input.js";
import { createPrivateCaptureWriter } from "./private-capture.js";
import { collectInterestingFindings, redactErrorMessage, summarizeObjectShape } from "./redaction.js";
import { validateAccountEmail } from "./validation.js";

const DEFAULT_TIMEOUT_MS = 10_000;
type LogMode = "all" | "interesting" | "summary";

async function main(): Promise<void> {
  const email = process.env.PROSCENIC_EMAIL || await promptLine("Proscenic account e-mail: ");
  const password = process.env.PROSCENIC_PASSWORD || await promptHidden("Proscenic password: ");
  validateAccountEmail(email);
  const region = parseRegion(process.env.PROSCENIC_REGION ?? "eu");
  const baseUrl = parseBaseUrl(process.env.PROSCENIC_BASE_URL);
  const deviceRegion = parseRegion(process.env.PROSCENIC_DEVICE_REGION ?? process.env.PROSCENIC_REGION ?? "eu");
  const deviceBaseUrl = parseBaseUrl(process.env.PROSCENIC_DEVICE_BASE_URL);
  const timeoutMs = parsePositiveInt(process.env.PROSCENIC_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const deviceIndex = parseNonNegativeInt(process.env.PROSCENIC_DEVICE_INDEX, 0);
  const group = process.env.PROSCENIC_REST_GROUP ?? "all";
  const startIndex = parseNonNegativeInt(process.env.PROSCENIC_REST_START_INDEX, 0);
  const maxCandidates = parseNonNegativeInt(process.env.PROSCENIC_REST_MAX_CANDIDATES, 0);
  const logMode = parseLogMode(process.env.PROSCENIC_REST_LOG_MODE ?? "all");
  const privateCapture = await createPrivateCaptureWriter(process.env.PROSCENIC_PRIVATE_CAPTURE !== "0");
  if (privateCapture) {
    console.log("Private REST capture: enabled, ignored local file created");
  }

  const client = new ProscenicRestProbeClient({ email, password, region, timeoutMs, baseUrl });
  const deviceClient = new ProscenicRestProbeClient({
    email,
    password,
    region: deviceRegion,
    timeoutMs,
    baseUrl: deviceBaseUrl,
  });
  console.log("Login: starting");
  const token = await client.login();
  console.log("Login: success, token received: true");

  const devices = await deviceClient.listDevices();
  console.log(`Devices: ${devices.length}`);
  if (devices.length === 0) {
    throw new Error(
      "No devices returned by legacy cloud. Check PROSCENIC_EMAIL, region, and whether this is the main Proscenic app account.",
    );
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

  const allCandidates = filterEndpointCandidates(group);
  const candidates = maxCandidates > 0
    ? allCandidates.slice(startIndex, startIndex + maxCandidates)
    : allCandidates.slice(startIndex);
  console.log("REST candidates:", JSON.stringify({
    group,
    totalAvailable: allCandidates.length,
    startIndex,
    count: candidates.length,
    maxCandidates: maxCandidates || null,
    logMode,
  }));
  await privateCapture?.write({
    kind: "run",
    createdAt: new Date().toISOString(),
    group,
    device: {
      index: deviceIndex,
      code: device.code ?? null,
      model: device.model ?? null,
      status: device.status ?? null,
    },
    candidateCount: candidates.length,
    totalAvailableCandidates: allCandidates.length,
    startIndex,
    maxCandidates: maxCandidates || null,
    logMode,
  });

  let interestingResponses = 0;
  const statusCounts = new Map<string, number>();
  const interestingCandidateIds: string[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const result = await probeCandidate(client, token, candidate, {
      username: email,
      serial: device.sn,
    });
    if (result.interestingCount > 0) {
      interestingResponses += 1;
      interestingCandidateIds.push(candidate.id);
    }
    increment(statusCounts, String(result.statusCode ?? result.error ?? "unknown"));
    if (shouldLogProbe(logMode, result)) {
      console.log("REST probe:", JSON.stringify({
        index: index + 1,
        total: candidates.length,
        absoluteIndex: startIndex + index,
        id: candidate.id,
        group: candidate.group,
        statusCode: result.statusCode,
        json: result.json,
        interestingCount: result.interestingCount,
        error: result.error ?? null,
      }));
    }
    if (result.shape && result.interestingCount > 0) {
      console.log("REST shape:", JSON.stringify({ id: candidate.id, shape: result.shape }));
    }
    if (result.findings.length > 0) {
      console.log("REST findings:", JSON.stringify({ id: candidate.id, findings: result.findings.slice(0, 20) }));
    }
    await privateCapture?.write({
      kind: "probe",
      candidate: {
        id: candidate.id,
        group: candidate.group,
        method: candidate.method,
        path: candidate.path({ username: "<redacted>", serial: "<redacted>" }),
        token: candidate.token,
      },
      result,
    });
  }

  console.log("REST completion:", JSON.stringify({
    candidates: candidates.length,
    totalAvailable: allCandidates.length,
    startIndex,
    interestingResponses,
    interestingCandidateIds: interestingCandidateIds.slice(0, 50),
    statusCounts: Object.fromEntries([...statusCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
  }));
  await privateCapture?.close();
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function shouldLogProbe(
  logMode: LogMode,
  result: { statusCode?: number; interestingCount: number; error?: string },
): boolean {
  if (logMode === "all") {
    return true;
  }
  if (logMode === "summary") {
    return false;
  }
  return result.interestingCount > 0 || result.statusCode !== 404 || result.error !== undefined;
}

async function probeCandidate(
  client: ProscenicRestProbeClient,
  token: string,
  candidate: EndpointCandidate,
  context: { username: string; serial: string },
): Promise<{
  statusCode?: number;
  json: boolean;
  textBytes?: number;
  shape?: unknown;
  findings: ReturnType<typeof collectInterestingFindings>;
  interestingCount: number;
  privateResponse?: {
    headers: Record<string, string | string[] | undefined>;
    text: string;
    json: unknown | undefined;
  };
  error?: string;
}> {
  try {
    const response = await client.probe({
      method: candidate.method,
      path: candidate.path(context),
      body: candidate.body?.(context),
      headers: candidate.token ? { token } : {},
    });
    const findings = collectInterestingFindings(response.json);
    return {
      statusCode: response.statusCode,
      json: response.json !== undefined,
      textBytes: Buffer.byteLength(response.text, "utf8"),
      shape: response.json === undefined ? undefined : summarizeObjectShape(response.json),
      findings,
      interestingCount: findings.length,
      privateResponse: {
        headers: response.headers,
        text: response.text,
        json: response.json,
      },
    };
  } catch (error) {
    return {
      json: false,
      findings: [],
      interestingCount: 0,
      error: redactErrorMessage(error),
    };
  }
}

function parseRegion(value: string): Region {
  if (value === "eu" || value === "tw") {
    return value;
  }
  throw new Error(`Unsupported region ${value}`);
}

function parseBaseUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("PROSCENIC_BASE_URL must use https");
  }
  return url.toString();
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

function parseLogMode(value: string): LogMode {
  if (value === "all" || value === "interesting" || value === "summary") {
    return value;
  }
  throw new Error(`Expected PROSCENIC_REST_LOG_MODE to be all, interesting, or summary, got ${value}`);
}

main().catch((error: unknown) => {
  console.error(`REST PoC failed: ${redactErrorMessage(error)}`);
  process.exitCode = 1;
});

import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { summarizeObjectShape } from "./redaction.js";
import { extractSafeStatus20001Values } from "./status-candidates.js";

const SAFE_ENUM_FIELDS = ["mode", "subMode", "workNoisy"] as const;
const SAFE_STATUS_NUMBER_FIELDS = [
  "allArea",
  "allTime",
  "cleanArea",
  "cleanMode",
  "cleanTime",
  "dustCenterFreq",
  "elec",
  "elecReal",
  "isInForbidMode",
  "ldAvoidColli",
  "led",
  "mop",
  "mute",
  "reliable",
  "timeStamp",
  "vol",
  "water",
  "workstationType",
] as const;
const SAFE_STATUS_BOOLEAN_FIELDS = ["autoBoost", "cleanComponents"] as const;
const MAP_METADATA_FIELDS = [
  "autoAreaId",
  "base64_len",
  "height",
  "lz4_len",
  "mapId",
  "pathId",
  "resolution",
  "width",
] as const;

export interface CaptureAnalysis {
  source: {
    file: string;
  };
  records: {
    total: number;
    malformed: number;
    runs: number;
    events: number;
    frameErrors: number;
  };
  runs: {
    completionReasons: Record<string, number>;
    maxCycles: number;
    maxElapsedMs: number;
  };
  gateway: {
    frameErrorMessages: Record<string, number>;
  };
  events: {
    infoTypes: Record<string, number>;
    dataShapes: Record<string, unknown>;
    fieldOccurrences: Record<string, Record<string, number>>;
  };
  status20001: {
    count: number;
    safeEnums: Record<string, string[]>;
    numberRanges: Record<string, NumberRange>;
    booleanCounts: Record<string, BooleanCounts>;
    errorStateLengths: Record<string, number>;
  };
  map20002: {
    count: number;
    availableCount: number;
    metadataRanges: Record<string, NumberRange>;
    areaCounts: Record<string, number>;
    encodedByteRanges: NumberRange | undefined;
  };
  privacy: {
    outputContainsRawPayloads: false;
    notes: string[];
  };
}

export interface NumberRange {
  min: number;
  max: number;
  count: number;
}

export interface BooleanCounts {
  true: number;
  false: number;
}

export async function analyzeCaptureFile(filePath: string): Promise<CaptureAnalysis> {
  const text = await readFile(filePath, "utf8");
  return analyzeCaptureLines(text.split(/\r?\n/u), basename(filePath));
}

export function analyzeCaptureLines(lines: string[], filePath: string): CaptureAnalysis {
  const analysis = createEmptyAnalysis(filePath);

  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }

    analysis.records.total += 1;
    const record = parseRecord(line);
    if (!record) {
      analysis.records.malformed += 1;
      continue;
    }

    if (record.kind === "run") {
      analyzeRunRecord(analysis, record);
      continue;
    }
    if (record.kind === "frame-error") {
      analyzeFrameErrorRecord(analysis, record);
      continue;
    }
    if (record.kind === "event") {
      analyzeEventRecord(analysis, record);
    }
  }

  sortAnalysis(analysis);
  return analysis;
}

export async function findLatestPrivateCapture(directory = ".poc-private/protocol-poc"): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const captures = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name)
    .sort();

  const latest = captures.at(-1);
  if (!latest) {
    throw new Error(`No private capture JSONL files found in ${directory}`);
  }

  return join(directory, latest);
}

function createEmptyAnalysis(filePath: string): CaptureAnalysis {
  return {
    source: {
      file: filePath,
    },
    records: {
      total: 0,
      malformed: 0,
      runs: 0,
      events: 0,
      frameErrors: 0,
    },
    runs: {
      completionReasons: {},
      maxCycles: 0,
      maxElapsedMs: 0,
    },
    gateway: {
      frameErrorMessages: {},
    },
    events: {
      infoTypes: {},
      dataShapes: {},
      fieldOccurrences: {},
    },
    status20001: {
      count: 0,
      safeEnums: {},
      numberRanges: {},
      booleanCounts: {},
      errorStateLengths: {},
    },
    map20002: {
      count: 0,
      availableCount: 0,
      metadataRanges: {},
      areaCounts: {},
      encodedByteRanges: undefined,
    },
    privacy: {
      outputContainsRawPayloads: false,
      notes: [
        "Analysis is derived from private capture records.",
        "Raw payload values, map bytes, positions, serials, tokens, accounts, and endpoints are intentionally omitted.",
      ],
    },
  };
}

function parseRecord(line: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Count malformed records without copying their text into the analysis.
  }

  return undefined;
}

function analyzeRunRecord(analysis: CaptureAnalysis, record: Record<string, unknown>): void {
  analysis.records.runs += 1;
  const gatewayCompletion = getRecord(record.gatewayCompletion);
  const reason = typeof gatewayCompletion?.reason === "string" ? gatewayCompletion.reason : "unknown";
  increment(analysis.runs.completionReasons, reason);

  const cycles = getNumber(gatewayCompletion, "cycles");
  if (cycles !== undefined) {
    analysis.runs.maxCycles = Math.max(analysis.runs.maxCycles, cycles);
  }

  const elapsedMs = getNumber(gatewayCompletion, "elapsedMs");
  if (elapsedMs !== undefined) {
    analysis.runs.maxElapsedMs = Math.max(analysis.runs.maxElapsedMs, elapsedMs);
  }
}

function analyzeFrameErrorRecord(analysis: CaptureAnalysis, record: Record<string, unknown>): void {
  analysis.records.frameErrors += 1;
  const message = typeof record.message === "string" ? record.message : "unknown";
  increment(analysis.gateway.frameErrorMessages, message);
}

function analyzeEventRecord(analysis: CaptureAnalysis, record: Record<string, unknown>): void {
  analysis.records.events += 1;
  const infoType = String(record.infoType ?? "unknown");
  increment(analysis.events.infoTypes, infoType);

  const decrypted = getRecord(record.decrypted);
  const data = decrypted?.data;
  analysis.events.dataShapes[infoType] = summarizeObjectShape(data);
  countFieldOccurrences(analysis, infoType, data);

  if (record.infoType === 20001) {
    analyzeStatus20001(analysis, data);
  }
  if (record.infoType === 20002) {
    analyzeMap20002(analysis, data);
  }
}

function analyzeStatus20001(analysis: CaptureAnalysis, data: unknown): void {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return;
  }

  analysis.status20001.count += 1;
  const record = data as Record<string, unknown>;
  const safeValues = extractSafeStatus20001Values(data);

  for (const field of SAFE_ENUM_FIELDS) {
    const value = safeValues?.[field];
    if (typeof value === "string") {
      addEnum(analysis.status20001.safeEnums, field, value);
    }
  }

  for (const field of SAFE_STATUS_NUMBER_FIELDS) {
    const value = record[field];
    if (typeof value === "number") {
      updateRange(analysis.status20001.numberRanges, field, value);
    }
  }

  for (const field of SAFE_STATUS_BOOLEAN_FIELDS) {
    const value = record[field];
    if (typeof value === "boolean") {
      updateBooleanCounts(analysis.status20001.booleanCounts, field, value);
    }
  }

  if (Array.isArray(record.errorState)) {
    increment(analysis.status20001.errorStateLengths, String(record.errorState.length));
  }
}

function analyzeMap20002(analysis: CaptureAnalysis, data: unknown): void {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return;
  }

  analysis.map20002.count += 1;
  const record = data as Record<string, unknown>;
  if (typeof record.map === "string" && record.map.length > 0) {
    analysis.map20002.availableCount += 1;
    analysis.map20002.encodedByteRanges = mergeRange(
      analysis.map20002.encodedByteRanges,
      Buffer.byteLength(record.map, "utf8"),
    );
  }

  for (const field of MAP_METADATA_FIELDS) {
    const value = record[field];
    if (typeof value === "number") {
      updateRange(analysis.map20002.metadataRanges, field, value);
    }
  }

  if (Array.isArray(record.area)) {
    increment(analysis.map20002.areaCounts, String(record.area.length));
  }
}

function countFieldOccurrences(analysis: CaptureAnalysis, infoType: string, data: unknown): void {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return;
  }

  const bucket = analysis.events.fieldOccurrences[infoType] ?? {};
  analysis.events.fieldOccurrences[infoType] = bucket;
  for (const key of Object.keys(data as Record<string, unknown>)) {
    increment(bucket, key);
  }
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function getNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

function increment(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] ?? 0) + 1;
}

function addEnum(bucket: Record<string, string[]>, key: string, value: string): void {
  const values = bucket[key] ?? [];
  if (!values.includes(value)) {
    values.push(value);
  }
  bucket[key] = values;
}

function updateRange(bucket: Record<string, NumberRange>, key: string, value: number): void {
  bucket[key] = mergeRange(bucket[key], value);
}

function mergeRange(range: NumberRange | undefined, value: number): NumberRange {
  if (!range) {
    return {
      min: value,
      max: value,
      count: 1,
    };
  }

  return {
    min: Math.min(range.min, value),
    max: Math.max(range.max, value),
    count: range.count + 1,
  };
}

function updateBooleanCounts(bucket: Record<string, BooleanCounts>, key: string, value: boolean): void {
  const counts = bucket[key] ?? {
    true: 0,
    false: 0,
  };
  if (value) {
    counts.true += 1;
  } else {
    counts.false += 1;
  }
  bucket[key] = counts;
}

function sortAnalysis(analysis: CaptureAnalysis): void {
  analysis.runs.completionReasons = sortNumberRecord(analysis.runs.completionReasons);
  analysis.gateway.frameErrorMessages = sortNumberRecord(analysis.gateway.frameErrorMessages);
  analysis.events.infoTypes = sortNumberRecord(analysis.events.infoTypes);
  analysis.events.fieldOccurrences = sortNestedNumberRecord(analysis.events.fieldOccurrences);
  analysis.status20001.errorStateLengths = sortNumberRecord(analysis.status20001.errorStateLengths);
  analysis.map20002.areaCounts = sortNumberRecord(analysis.map20002.areaCounts);

  for (const [key, values] of Object.entries(analysis.status20001.safeEnums)) {
    analysis.status20001.safeEnums[key] = values.sort();
  }
}

function sortNumberRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function sortNestedNumberRecord(record: Record<string, Record<string, number>>): Record<string, Record<string, number>> {
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, sortNumberRecord(value)]),
  );
}

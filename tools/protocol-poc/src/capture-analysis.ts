import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { decodeMapPayload } from "./map-payload.js";
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
const STATUS_SEQUENCE_FIELDS = [
  "mode",
  "subMode",
  "workNoisy",
  "cleanTime",
  "cleanArea",
  "elec",
  "elecReal",
  "water",
  "mop",
  "errorStateLength",
] as const;
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
const MAP_SEQUENCE_FIELDS = [
  "mapId",
  "pathId",
  "base64_len",
  "lz4_len",
  "areaCount",
  "encodedBytes",
] as const;
const MAP_BLOCK_STATE = Symbol("mapBlockState");
const EXTRA_SAFE_SEQUENCE_FIELDS = [
  "code",
  "cmd",
  "command",
  "data",
  "error",
  "message",
  "mode",
  "result",
  "status",
  "subMode",
  "type",
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
    extraSequences: Record<string, Record<string, FieldSequence>>;
  };
  status20001: {
    count: number;
    safeEnums: Record<string, string[]>;
    numberRanges: Record<string, NumberRange>;
    booleanCounts: Record<string, BooleanCounts>;
    errorStateLengths: Record<string, number>;
    sequences: Record<string, FieldSequence>;
  };
  map20002: {
    count: number;
    availableCount: number;
    metadataRanges: Record<string, NumberRange>;
    areaCounts: Record<string, number>;
    encodedByteRanges: NumberRange | undefined;
    sequences: Record<string, FieldSequence>;
    pathSegments: MapPathSegment[];
    blockSignals: MapBlockSignals;
  };
  privacy: {
    outputContainsRawPayloads: false;
    notes: string[];
  };
}

export interface MapBlockSignals {
  samples: number;
  stablePrefixBytes: number | undefined;
  adjacentSameDecodedSize: number;
  adjacentChangedDecodedSize: number;
  adjacentSamePayload: number;
  adjacentChangedPayload: number;
  interpretation: "snapshot-like" | "movement-only-possible" | "insufficient-evidence";
  notes: string[];
}

export interface MapPathSegment {
  label: string;
  pathId: SafeSequenceValue;
  firstEvent: number;
  lastEvent: number;
  events: number;
  encodedBytes: NumberRange | undefined;
  decodedBytes: NumberRange | undefined;
  areaCounts: Record<string, number>;
}

interface MapBlockState {
  firstPayload: Buffer | undefined;
  previousPayload: Buffer | undefined;
  currentPathSegment: MapPathSegment | undefined;
}

type AnalysisWithPrivateState = CaptureAnalysis & {
  [MAP_BLOCK_STATE]: MapBlockState;
};

export interface NumberRange {
  min: number;
  max: number;
  count: number;
}

export interface BooleanCounts {
  true: number;
  false: number;
}

export type SafeSequenceValue = string | number | boolean | null;

export interface FieldSequence {
  first: SafeSequenceValue;
  last: SafeSequenceValue;
  observations: number;
  changes: number;
  transitions: FieldTransition[];
}

export interface FieldTransition {
  event: number;
  from: SafeSequenceValue;
  to: SafeSequenceValue;
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
  const analysis: AnalysisWithPrivateState = {
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
      extraSequences: {},
    },
    status20001: {
      count: 0,
      safeEnums: {},
      numberRanges: {},
      booleanCounts: {},
      errorStateLengths: {},
      sequences: {},
    },
    map20002: {
      count: 0,
      availableCount: 0,
      metadataRanges: {},
      areaCounts: {},
      encodedByteRanges: undefined,
      sequences: {},
      pathSegments: [],
      blockSignals: {
        samples: 0,
        stablePrefixBytes: undefined,
        adjacentSameDecodedSize: 0,
        adjacentChangedDecodedSize: 0,
        adjacentSamePayload: 0,
        adjacentChangedPayload: 0,
        interpretation: "insufficient-evidence",
        notes: [],
      },
    },
    privacy: {
      outputContainsRawPayloads: false,
      notes: [
        "Analysis is derived from private capture records.",
        "Raw payload values, map bytes, positions, serials, tokens, accounts, and endpoints are intentionally omitted.",
      ],
    },
    [MAP_BLOCK_STATE]: {
      firstPayload: undefined,
      previousPayload: undefined,
      currentPathSegment: undefined,
    },
  };

  return analysis;
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
  const eventIndex = typeof record.index === "number" ? record.index : analysis.records.events;
  const infoType = String(record.infoType ?? "unknown");
  increment(analysis.events.infoTypes, infoType);

  const decrypted = getRecord(record.decrypted);
  const data = decrypted?.data;
  analysis.events.dataShapes[infoType] = summarizeObjectShape(data);
  countFieldOccurrences(analysis, infoType, data);
  analyzeExtraInfoTypeSequences(analysis, infoType, data, eventIndex);

  if (record.infoType === 20001) {
    analyzeStatus20001(analysis, data, eventIndex);
  }
  if (record.infoType === 20002) {
    analyzeMap20002(analysis, data, eventIndex);
  }
}

function analyzeExtraInfoTypeSequences(
  analysis: CaptureAnalysis,
  infoType: string,
  data: unknown,
  eventIndex: number,
): void {
  if (infoType === "20001" || infoType === "20002") {
    return;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return;
  }

  const record = data as Record<string, unknown>;
  const bucket = analysis.events.extraSequences[infoType] ?? {};
  analysis.events.extraSequences[infoType] = bucket;

  for (const field of EXTRA_SAFE_SEQUENCE_FIELDS) {
    const value = safeExtraSequenceValue(field, record[field]);
    updateSequenceIfDefined(bucket, field, value, eventIndex);
  }

  for (const [field, value] of Object.entries(record)) {
    if (EXTRA_SAFE_SEQUENCE_FIELDS.includes(field as (typeof EXTRA_SAFE_SEQUENCE_FIELDS)[number])) {
      continue;
    }
    const safeValue = safeExtraSequenceValue(field, value);
    if (safeValue !== undefined) {
      updateSequenceIfDefined(bucket, field, safeValue, eventIndex);
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [childField, childValue] of Object.entries(value as Record<string, unknown>)) {
        const nestedValue = safeExtraSequenceValue(childField, childValue);
        updateSequenceIfDefined(bucket, `${field}.${childField}`, nestedValue, eventIndex);
      }
    }
  }
}

function analyzeStatus20001(analysis: CaptureAnalysis, data: unknown, eventIndex: number): void {
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

  const sequenceValues = safeStatusSequenceValues(record, safeValues);
  for (const field of STATUS_SEQUENCE_FIELDS) {
    updateSequenceIfDefined(analysis.status20001.sequences, field, sequenceValues[field], eventIndex);
  }
}

function analyzeMap20002(analysis: CaptureAnalysis, data: unknown, eventIndex: number): void {
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
    analyzeMapBlockSignals(analysis as AnalysisWithPrivateState, record.map);
  }
  updateMapPathSegment(analysis as AnalysisWithPrivateState, record, eventIndex);

  for (const field of MAP_METADATA_FIELDS) {
    const value = record[field];
    if (typeof value === "number") {
      updateRange(analysis.map20002.metadataRanges, field, value);
    }
  }

  if (Array.isArray(record.area)) {
    increment(analysis.map20002.areaCounts, String(record.area.length));
  }

  const sequenceValues = safeMapSequenceValues(record);
  for (const field of MAP_SEQUENCE_FIELDS) {
    updateSequenceIfDefined(analysis.map20002.sequences, field, sequenceValues[field], eventIndex);
  }
}

function updateMapPathSegment(
  analysis: AnalysisWithPrivateState,
  record: Record<string, unknown>,
  eventIndex: number,
): void {
  const pathIdValue = safeExtraSequenceValue("pathId", record.pathId) ?? "unknown";
  const state = analysis[MAP_BLOCK_STATE];
  const current = state.currentPathSegment;

  if (!current || current.pathId !== pathIdValue) {
    const label = `path-${String(pathIdValue)}-from-${eventIndex}`;
    state.currentPathSegment = {
      label,
      pathId: pathIdValue,
      firstEvent: eventIndex,
      lastEvent: eventIndex,
      events: 0,
      encodedBytes: undefined,
      decodedBytes: undefined,
      areaCounts: {},
    };
    analysis.map20002.pathSegments.push(state.currentPathSegment);
  }

  const segment = state.currentPathSegment;
  if (!segment) {
    throw new Error("Internal map path segment state was not initialized");
  }
  segment.events += 1;
  segment.lastEvent = eventIndex;

  if (typeof record.map === "string") {
    segment.encodedBytes = mergeRange(segment.encodedBytes, Buffer.byteLength(record.map, "utf8"));
    segment.decodedBytes = mergeRange(segment.decodedBytes, decodeMapPayload(record.map).compressed.length);
  }
  if (Array.isArray(record.area)) {
    increment(segment.areaCounts, String(record.area.length));
  }
}

function analyzeMapBlockSignals(analysis: AnalysisWithPrivateState, encodedMap: string): void {
  const payload = decodeMapPayload(encodedMap).compressed;
  const signals = analysis.map20002.blockSignals;
  const state = analysis[MAP_BLOCK_STATE];

  signals.samples += 1;
  if (!state.firstPayload) {
    state.firstPayload = payload;
    signals.stablePrefixBytes = payload.length;
  } else {
    signals.stablePrefixBytes = Math.min(
      signals.stablePrefixBytes ?? payload.length,
      commonPrefixLength(state.firstPayload, payload),
    );
  }

  if (state.previousPayload) {
    if (state.previousPayload.length === payload.length) {
      signals.adjacentSameDecodedSize += 1;
    } else {
      signals.adjacentChangedDecodedSize += 1;
    }

    if (state.previousPayload.equals(payload)) {
      signals.adjacentSamePayload += 1;
    } else {
      signals.adjacentChangedPayload += 1;
    }
  }

  state.previousPayload = payload;
}

function commonPrefixLength(left: Buffer, right: Buffer): number {
  const limit = Math.min(left.length, right.length);
  for (let index = 0; index < limit; index++) {
    if (left[index] !== right[index]) {
      return index;
    }
  }
  return limit;
}

function safeStatusSequenceValues(
  record: Record<string, unknown>,
  safeValues: ReturnType<typeof extractSafeStatus20001Values>,
): Partial<Record<(typeof STATUS_SEQUENCE_FIELDS)[number], SafeSequenceValue>> {
  const values: Partial<Record<(typeof STATUS_SEQUENCE_FIELDS)[number], SafeSequenceValue>> = {};

  for (const field of ["mode", "subMode", "workNoisy"] as const) {
    const value = safeValues?.[field];
    if (typeof value === "string") {
      values[field] = value;
    }
  }

  for (const field of ["cleanTime", "cleanArea", "elec", "elecReal", "water", "mop"] as const) {
    const value = record[field];
    if (typeof value === "number") {
      values[field] = value;
    }
  }

  if (Array.isArray(record.errorState)) {
    values.errorStateLength = record.errorState.length;
  }

  return values;
}

function safeMapSequenceValues(
  record: Record<string, unknown>,
): Partial<Record<(typeof MAP_SEQUENCE_FIELDS)[number], SafeSequenceValue>> {
  const values: Partial<Record<(typeof MAP_SEQUENCE_FIELDS)[number], SafeSequenceValue>> = {};

  for (const field of ["mapId", "pathId", "base64_len", "lz4_len"] as const) {
    const value = record[field];
    if (typeof value === "number") {
      values[field] = value;
    }
  }

  if (Array.isArray(record.area)) {
    values.areaCount = record.area.length;
  }
  if (typeof record.map === "string") {
    values.encodedBytes = Buffer.byteLength(record.map, "utf8");
  }

  return values;
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

function safeExtraSequenceValue(key: string, value: unknown): SafeSequenceValue | undefined {
  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    if (/message|msg|title|text/iu.test(key)) {
      return `<string:${value.length}>`;
    }
    if (value.length > 80) {
      return `<string:${value.length}>`;
    }
    if (looksPrivateString(value)) {
      return "<redacted>";
    }
    return value;
  }
  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return `array:${value.length}`;
  }
  if (value !== null && typeof value === "object") {
    return "object";
  }
  return undefined;
}

function looksPrivateString(value: string): boolean {
  return /@|token|secret|password|[a-f0-9]{24,}/iu.test(value);
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

function updateSequenceIfDefined(
  bucket: Record<string, FieldSequence>,
  key: string,
  value: SafeSequenceValue | undefined,
  eventIndex: number,
): void {
  if (value === undefined) {
    return;
  }

  const current = bucket[key];
  if (!current) {
    bucket[key] = {
      first: value,
      last: value,
      observations: 1,
      changes: 0,
      transitions: [],
    };
    return;
  }

  current.observations += 1;
  if (current.last !== value) {
    current.transitions.push({
      event: eventIndex,
      from: current.last,
      to: value,
    });
    current.last = value;
    current.changes += 1;
  }
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
  analysis.events.extraSequences = sortNestedSequenceRecord(analysis.events.extraSequences);
  analysis.status20001.errorStateLengths = sortNumberRecord(analysis.status20001.errorStateLengths);
  analysis.map20002.areaCounts = sortNumberRecord(analysis.map20002.areaCounts);
  analysis.map20002.pathSegments = analysis.map20002.pathSegments.map((segment) => ({
    ...segment,
    areaCounts: sortNumberRecord(segment.areaCounts),
  }));

  for (const [key, values] of Object.entries(analysis.status20001.safeEnums)) {
    analysis.status20001.safeEnums[key] = values.sort();
  }
  finalizeMapBlockSignals(analysis);
}

function sortNestedSequenceRecord(record: Record<string, Record<string, FieldSequence>>): Record<string, Record<string, FieldSequence>> {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => Object.keys(value).length > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))]),
  );
}

function finalizeMapBlockSignals(analysis: CaptureAnalysis): void {
  const signals = analysis.map20002.blockSignals;
  signals.notes = [];

  if (signals.samples < 2) {
    signals.interpretation = "insufficient-evidence";
    signals.notes.push("Need at least two map samples to compare whether the map block behaves like a snapshot or a delta.");
    return;
  }

  const dimensionsStable =
    (analysis.map20002.metadataRanges.width?.min === analysis.map20002.metadataRanges.width?.max) &&
    (analysis.map20002.metadataRanges.height?.min === analysis.map20002.metadataRanges.height?.max);
  const mapIdStable = analysis.map20002.sequences.mapId?.changes === 0;
  const pathChanges = analysis.map20002.sequences.pathId?.changes ?? 0;
  const payloadChanges = signals.adjacentChangedPayload;

  if (dimensionsStable && mapIdStable && payloadChanges > 0) {
    signals.interpretation = "snapshot-like";
    signals.notes.push("Stable dimensions and mapId with changing self-contained map blocks suggest repeated map snapshots with run/path overlay.");
    if (pathChanges > 0) {
      signals.notes.push("A pathId change was observed while the mapId stayed stable, which separates base map identity from the active path/run.");
    }
    return;
  }

  signals.interpretation = "movement-only-possible";
  signals.notes.push("The observed fields do not yet prove a complete base-map snapshot; compare additional captures and rendered coordinate probes.");
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

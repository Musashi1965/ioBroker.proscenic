import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { findLatestPrivateCapture } from "./capture-analysis.js";
import { decodeMapPayload, decompressLz4Block } from "./map-payload.js";

const MAX_LZ4_SCAN_OFFSET = 256;
const MAX_DECOMPRESSED_BYTES = 262_144;
const HEADER_SCAN_BYTES = 128;
const GRID_WIDTH_CANDIDATES = [205, 204, 203, 208, 200, 187, 128, 256] as const;

export interface AnalyzeMapFormatOptions {
  capturePath?: string;
  latest?: boolean;
}

export interface MapFormatAnalysis {
  source: {
    file: string;
  };
  samples: {
    total: number;
    selectedEvent: number | undefined;
    pathSegments: MapFormatPathSegment[];
  };
  geometry: {
    width: number | undefined;
    height: number | undefined;
    resolution: number | undefined;
    expectedPixels: number | undefined;
    xMin: number | undefined;
    yMin: number | undefined;
    coordinateProjectionAvailable: boolean;
    areaVertexProjection: ProjectionSignal | undefined;
    chargeProjection: ProjectionSignal | undefined;
  };
  payload: {
    decodedBytes: NumberRange | undefined;
    encodedBytes: NumberRange | undefined;
    directBitmapFeasibility: BitmapFeasibility[];
    commonPrefixBytes: NumberRange | undefined;
    adjacentChanges: AdjacentChangeSummary;
    headerSignals: HeaderSignals;
  };
  compression: {
    lz4BlockCandidates: Lz4Candidate[];
    conclusion: string;
  };
  rasterHypotheses: RasterHypothesis[];
  interpretation: {
    findings: string[];
    nextSteps: string[];
  };
  privacy: {
    outputContainsRawPayloads: false;
    notes: string[];
  };
}

export interface MapFormatPathSegment {
  pathId: number | "unknown";
  firstEvent: number;
  lastEvent: number;
  events: number;
  decodedBytes: NumberRange | undefined;
}

export interface ProjectionSignal {
  projectedPoints: number;
  inBounds: number;
  bounds: Bounds | undefined;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface NumberRange {
  min: number;
  max: number;
  count: number;
}

export interface BitmapFeasibility {
  bitsPerCell: 1 | 2 | 4 | 8;
  requiredBytes: number;
  possibleWithoutCompression: boolean;
}

export interface AdjacentChangeSummary {
  comparisons: number;
  samePayload: number;
  changedPayload: number;
  sameSize: number;
  changedSize: number;
  byteChangeRatio: NumberRange | undefined;
}

export interface HeaderSignals {
  stablePrefixBytes: number | undefined;
  mostlyStablePrefixBytes: number | undefined;
  changingOffsetsInFirstBytes: number[];
}

export interface Lz4Candidate {
  offset: number;
  decompressedBytes: number;
  uniqueByteValues: number;
  expectedPixelRatio: number | undefined;
}

export interface RasterHypothesis {
  name: string;
  startOffset: number;
  stride: number;
  rows: number;
  filledCells: number;
  coverageRatio: number;
  components: number;
  largestComponentCells: number;
  largestComponentRatio: number;
  structureScore: number;
}

interface MapSample {
  eventIndex: number;
  pathId: number | undefined;
  width: number | undefined;
  height: number | undefined;
  resolution: number | undefined;
  xMin: number | undefined;
  yMin: number | undefined;
  decoded: Buffer;
  encodedBytes: number;
  areas: Array<Array<[number, number]>>;
  chargeHandlePos: [number, number] | undefined;
}

export async function analyzeLatestPrivateMapFormat(): Promise<MapFormatAnalysis> {
  return analyzeMapFormat({ capturePath: await findLatestPrivateCapture() });
}

export async function analyzeMapFormat(options: AnalyzeMapFormatOptions): Promise<MapFormatAnalysis> {
  const capturePath = options.latest || !options.capturePath
    ? await findLatestPrivateCapture()
    : options.capturePath;
  const samples = await readMapSamples(capturePath);
  const selected = samples.at(-1);
  const expectedPixels = selected?.width && selected.height ? selected.width * selected.height : undefined;

  const analysis: MapFormatAnalysis = {
    source: {
      file: basename(capturePath),
    },
    samples: {
      total: samples.length,
      selectedEvent: selected?.eventIndex,
      pathSegments: summarizePathSegments(samples),
    },
    geometry: {
      width: selected?.width,
      height: selected?.height,
      resolution: selected?.resolution,
      expectedPixels,
      xMin: selected?.xMin,
      yMin: selected?.yMin,
      coordinateProjectionAvailable: hasCoordinateProjection(selected),
      areaVertexProjection: selected ? areaVertexProjection(selected) : undefined,
      chargeProjection: selected ? chargeProjection(selected) : undefined,
    },
    payload: {
      decodedBytes: summarizeRange(samples.map((sample) => sample.decoded.length)),
      encodedBytes: summarizeRange(samples.map((sample) => sample.encodedBytes)),
      directBitmapFeasibility: expectedPixels === undefined ? [] : directBitmapFeasibility(expectedPixels, selected?.decoded.length ?? 0),
      commonPrefixBytes: commonPrefixRange(samples),
      adjacentChanges: adjacentChangeSummary(samples),
      headerSignals: headerSignals(samples),
    },
    compression: {
      lz4BlockCandidates: selected ? scanLz4Candidates(selected.decoded, expectedPixels) : [],
      conclusion: "not-scanned",
    },
    rasterHypotheses: selected ? rasterHypotheses(selected.decoded) : [],
    interpretation: {
      findings: [],
      nextSteps: [],
    },
    privacy: {
      outputContainsRawPayloads: false,
      notes: [
        "Map format analysis is derived from private captures without printing raw map bytes, coordinates, serials, tokens, accounts, or endpoints.",
        "Projection bounds and aggregate statistics may still describe private home layout characteristics and should remain local unless reviewed.",
      ],
    },
  };

  analysis.compression.conclusion = compressionConclusion(analysis.compression.lz4BlockCandidates);
  analysis.interpretation = interpretAnalysis(analysis);
  return analysis;
}

async function readMapSamples(capturePath: string): Promise<MapSample[]> {
  const text = await readFile(capturePath, "utf8");
  const samples: MapSample[] = [];

  for (const line of text.split(/\r?\n/u)) {
    if (line.trim().length === 0) {
      continue;
    }
    const record = parseRecord(line);
    if (record?.kind !== "event" || record.infoType !== 20002) {
      continue;
    }

    const data = getRecord(getRecord(record.decrypted)?.data);
    if (!data || typeof data.map !== "string") {
      continue;
    }

    samples.push({
      eventIndex: typeof record.index === "number" ? record.index : samples.length + 1,
      pathId: typeof data.pathId === "number" ? data.pathId : undefined,
      width: typeof data.width === "number" ? data.width : undefined,
      height: typeof data.height === "number" ? data.height : undefined,
      resolution: typeof data.resolution === "number" ? data.resolution : undefined,
      xMin: typeof data.x_min === "number" ? data.x_min : undefined,
      yMin: typeof data.y_min === "number" ? data.y_min : undefined,
      decoded: decodeMapPayload(data.map).compressed,
      encodedBytes: Buffer.byteLength(data.map, "utf8"),
      areas: parseAreas(data.area),
      chargeHandlePos: parsePoint(data.chargeHandlePos),
    });
  }

  return samples;
}

export async function findPrivateMapCaptures(directory = ".poc-private/protocol-poc"): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => join(directory, entry.name))
    .sort();
}

function parseRecord(line: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed private records without retaining their content.
  }
  return undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseAreas(value: unknown): Array<Array<[number, number]>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      const record = getRecord(entry);
      if (!record || !Array.isArray(record.vertexs)) {
        return [];
      }
      return record.vertexs
        .map((vertex) => parsePoint(vertex))
        .filter((point): point is [number, number] => point !== undefined);
    })
    .filter((vertices) => vertices.length >= 3);
}

function parsePoint(value: unknown): [number, number] | undefined {
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    return [value[0], value[1]];
  }
  return undefined;
}

function summarizePathSegments(samples: MapSample[]): MapFormatPathSegment[] {
  const segments: MapFormatPathSegment[] = [];
  for (const sample of samples) {
    const pathId = sample.pathId ?? "unknown";
    const current = segments.at(-1);
    if (!current || current.pathId !== pathId) {
      segments.push({
        pathId,
        firstEvent: sample.eventIndex,
        lastEvent: sample.eventIndex,
        events: 1,
        decodedBytes: summarizeRange([sample.decoded.length]),
      });
      continue;
    }
    current.lastEvent = sample.eventIndex;
    current.events += 1;
    current.decodedBytes = mergeRange(current.decodedBytes, sample.decoded.length);
  }
  return segments;
}

function hasCoordinateProjection(sample: MapSample | undefined): boolean {
  return sample?.width !== undefined &&
    sample.height !== undefined &&
    sample.resolution !== undefined &&
    sample.xMin !== undefined &&
    sample.yMin !== undefined;
}

function areaVertexProjection(sample: MapSample): ProjectionSignal | undefined {
  if (!hasCoordinateProjection(sample)) {
    return undefined;
  }
  const projected = sample.areas.flatMap((area) => area.map((point) => projectPoint(sample, point)));
  return projectionSignal(projected, sample.width ?? 0, sample.height ?? 0);
}

function chargeProjection(sample: MapSample): ProjectionSignal | undefined {
  if (!hasCoordinateProjection(sample) || !sample.chargeHandlePos) {
    return undefined;
  }
  return projectionSignal([projectPoint(sample, sample.chargeHandlePos)], sample.width ?? 0, sample.height ?? 0);
}

function projectionSignal(points: Array<[number, number] | undefined>, width: number, height: number): ProjectionSignal {
  const valid = points.filter((point): point is [number, number] => point !== undefined);
  const inBounds = valid.filter(([x, y]) => x >= 0 && x < width && y >= 0 && y < height);
  return {
    projectedPoints: points.length,
    inBounds: inBounds.length,
    bounds: boundsFor(inBounds),
  };
}

function projectPoint(sample: MapSample, point: [number, number]): [number, number] | undefined {
  if (
    sample.width === undefined ||
    sample.height === undefined ||
    sample.resolution === undefined ||
    sample.xMin === undefined ||
    sample.yMin === undefined
  ) {
    return undefined;
  }
  const x = Math.round((point[0] / 1000 - sample.xMin) / sample.resolution);
  const y = sample.height - 1 - Math.round((point[1] / 1000 - sample.yMin) / sample.resolution);
  return [x, y];
}

function boundsFor(points: Array<[number, number]>): Bounds | undefined {
  if (points.length === 0) {
    return undefined;
  }
  return {
    minX: Math.min(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxX: Math.max(...points.map(([x]) => x)),
    maxY: Math.max(...points.map(([, y]) => y)),
  };
}

function directBitmapFeasibility(expectedPixels: number, decodedBytes: number): BitmapFeasibility[] {
  return ([1, 2, 4, 8] as const).map((bitsPerCell) => {
    const requiredBytes = Math.ceil((expectedPixels * bitsPerCell) / 8);
    return {
      bitsPerCell,
      requiredBytes,
      possibleWithoutCompression: decodedBytes >= requiredBytes,
    };
  });
}

function commonPrefixRange(samples: MapSample[]): NumberRange | undefined {
  const values: number[] = [];
  for (let index = 1; index < samples.length; index++) {
    values.push(commonPrefixLength(samples[index - 1].decoded, samples[index].decoded));
  }
  return summarizeRange(values);
}

function adjacentChangeSummary(samples: MapSample[]): AdjacentChangeSummary {
  const ratios: number[] = [];
  let samePayload = 0;
  let changedPayload = 0;
  let sameSize = 0;
  let changedSize = 0;

  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1].decoded;
    const current = samples[index].decoded;
    if (previous.length === current.length) {
      sameSize += 1;
    } else {
      changedSize += 1;
    }
    if (previous.equals(current)) {
      samePayload += 1;
    } else {
      changedPayload += 1;
    }

    const limit = Math.min(previous.length, current.length);
    let changed = Math.abs(previous.length - current.length);
    for (let byte = 0; byte < limit; byte++) {
      if (previous[byte] !== current[byte]) {
        changed += 1;
      }
    }
    ratios.push(roundRatio(changed, Math.max(previous.length, current.length)));
  }

  return {
    comparisons: Math.max(0, samples.length - 1),
    samePayload,
    changedPayload,
    sameSize,
    changedSize,
    byteChangeRatio: summarizeRange(ratios),
  };
}

function headerSignals(samples: MapSample[]): HeaderSignals {
  if (samples.length < 2) {
    return {
      stablePrefixBytes: undefined,
      mostlyStablePrefixBytes: undefined,
      changingOffsetsInFirstBytes: [],
    };
  }

  const stableCounts = new Array<number>(HEADER_SCAN_BYTES).fill(0);
  for (let offset = 0; offset < HEADER_SCAN_BYTES; offset++) {
    for (let index = 1; index < samples.length; index++) {
      if (samples[index - 1].decoded[offset] !== undefined && samples[index - 1].decoded[offset] === samples[index].decoded[offset]) {
        stableCounts[offset] += 1;
      }
    }
  }

  let stablePrefixBytes = 0;
  while (stablePrefixBytes < stableCounts.length && stableCounts[stablePrefixBytes] === samples.length - 1) {
    stablePrefixBytes += 1;
  }

  let mostlyStablePrefixBytes = 0;
  while (
    mostlyStablePrefixBytes < stableCounts.length &&
    stableCounts[mostlyStablePrefixBytes] >= Math.floor((samples.length - 1) * 0.9)
  ) {
    mostlyStablePrefixBytes += 1;
  }

  return {
    stablePrefixBytes,
    mostlyStablePrefixBytes,
    changingOffsetsInFirstBytes: stableCounts
      .map((count, offset) => ({ count, offset }))
      .filter(({ count }) => count < samples.length - 1)
      .map(({ offset }) => offset)
      .slice(0, 32),
  };
}

function scanLz4Candidates(payload: Buffer, expectedPixels: number | undefined): Lz4Candidate[] {
  const candidates: Lz4Candidate[] = [];
  for (let offset = 0; offset < Math.min(MAX_LZ4_SCAN_OFFSET, payload.length); offset++) {
    try {
      const decompressed = decompressLz4Block(payload.subarray(offset), MAX_DECOMPRESSED_BYTES);
      if (decompressed.length === 0) {
        continue;
      }
      candidates.push({
        offset,
        decompressedBytes: decompressed.length,
        uniqueByteValues: new Set(decompressed).size,
        expectedPixelRatio: expectedPixels === undefined ? undefined : roundRatio(decompressed.length, expectedPixels),
      });
    } catch {
      // Negative scan results are expected for unknown binary formats.
    }
  }
  return candidates.slice(0, 20);
}

function compressionConclusion(candidates: Lz4Candidate[]): string {
  const exactOccupancy = candidates.find((candidate) => candidate.offset === 0 && candidate.expectedPixelRatio === 1);
  if (exactOccupancy) {
    return "Raw LZ4 at offset 0 decompresses to exactly the reported map width*height. This is the current strongest candidate for the occupancy grid.";
  }
  if (candidates.length === 0) {
    return "No valid raw LZ4 block was found in the scanned prefix offsets. The map body may use another block layout, framing, compression variant, or non-LZ4 encoding despite the lz4_len metadata name.";
  }
  return "At least one raw LZ4 block candidate was found. Inspect decompressed length and rendered probes before treating it as the real map body.";
}

function rasterHypotheses(payload: Buffer): RasterHypothesis[] {
  const hypotheses: RasterHypothesis[] = [];
  const startOffsets = [0, 4, 8, 12, 16, 24, 32, 39, 40, 48, 64, 96, 128];
  for (const stride of GRID_WIDTH_CANDIDATES) {
    for (const startOffset of startOffsets) {
      if (startOffset >= payload.length) {
        continue;
      }
      hypotheses.push(scoreRasterHypothesis(`byte-threshold-stride-${stride}-offset-${startOffset}`, payload, startOffset, stride));
      hypotheses.push(scoreBitRasterHypothesis(`bitplane-stride-${stride}-offset-${startOffset}`, payload, startOffset, stride));
    }
  }
  return hypotheses
    .sort((left, right) => right.structureScore - left.structureScore)
    .slice(0, 20);
}

function scoreRasterHypothesis(name: string, payload: Buffer, startOffset: number, stride: number): RasterHypothesis {
  const rows = Math.ceil((payload.length - startOffset) / stride);
  const cells = new Set<number>();
  for (let index = startOffset; index < payload.length; index++) {
    const value = payload[index];
    if (value === 0 || value === 0xff) {
      continue;
    }
    const cell = index - startOffset;
    cells.add(Math.floor(cell / stride) * stride + (cell % stride));
  }
  return scoreCells(name, startOffset, stride, rows, cells);
}

function scoreBitRasterHypothesis(name: string, payload: Buffer, startOffset: number, stride: number): RasterHypothesis {
  const bitCount = Math.max(0, (payload.length - startOffset) * 8);
  const rows = Math.ceil(bitCount / stride);
  const cells = new Set<number>();
  let cell = 0;
  for (let index = startOffset; index < payload.length; index++) {
    const value = payload[index];
    for (let bit = 7; bit >= 0; bit--) {
      if (((value >> bit) & 1) === 1) {
        cells.add(cell);
      }
      cell += 1;
    }
  }
  return scoreCells(name, startOffset, stride, rows, cells);
}

function scoreCells(name: string, startOffset: number, stride: number, rows: number, cells: Set<number>): RasterHypothesis {
  const visited = new Set<number>();
  let components = 0;
  let largestComponentCells = 0;
  for (const cell of cells) {
    if (visited.has(cell)) {
      continue;
    }
    components += 1;
    const size = floodCells(cell, cells, visited, stride, rows);
    largestComponentCells = Math.max(largestComponentCells, size);
  }

  const filledCells = cells.size;
  const coverageRatio = roundRatio(filledCells, stride * rows);
  const largestComponentRatio = roundRatio(largestComponentCells, filledCells);
  const componentPenalty = components === 0 ? 0 : Math.min(1, components / Math.max(1, filledCells));
  const densityPenalty = coverageRatio > 0.75 || coverageRatio < 0.01 ? 0.2 : 0;
  const structureScore = Math.round(Math.max(0, largestComponentRatio - componentPenalty - densityPenalty) * 1000) / 1000;

  return {
    name,
    startOffset,
    stride,
    rows,
    filledCells,
    coverageRatio,
    components,
    largestComponentCells,
    largestComponentRatio,
    structureScore,
  };
}

function floodCells(start: number, cells: Set<number>, visited: Set<number>, stride: number, rows: number): number {
  const queue = [start];
  visited.add(start);
  let size = 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor];
    size += 1;
    const x = cell % stride;
    const y = Math.floor(cell / stride);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
      if (nx < 0 || nx >= stride || ny < 0 || ny >= rows) {
        continue;
      }
      const neighbor = ny * stride + nx;
      if (cells.has(neighbor) && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return size;
}

function interpretAnalysis(analysis: MapFormatAnalysis): MapFormatAnalysis["interpretation"] {
  const findings: string[] = [];
  const nextSteps: string[] = [];

  const oneBit = analysis.payload.directBitmapFeasibility.find((item) => item.bitsPerCell === 1);
  if (oneBit && !oneBit.possibleWithoutCompression) {
    findings.push("The selected decoded payload is smaller than an uncompressed 1-bit-per-cell full map, so the filled app map cannot be a direct full-size bitmap at the reported dimensions.");
  }
  if (analysis.geometry.areaVertexProjection?.inBounds) {
    findings.push("Coordinate metadata projects area vertices into the map bounds, supporting the x_min/y_min/resolution conversion used for no-go overlays.");
  }
  if (analysis.geometry.chargeProjection?.inBounds) {
    findings.push("The charger position projects into the map bounds, supporting the same coordinate conversion for dock overlays.");
  }
  if (analysis.compression.lz4BlockCandidates.length === 0) {
    findings.push("No raw LZ4 block candidate was found in the first scanned offsets, despite lz4_len-style metadata.");
  } else if (analysis.compression.lz4BlockCandidates.some((candidate) => candidate.offset === 0 && candidate.expectedPixelRatio === 1)) {
    findings.push("Raw LZ4 at offset 0 decompresses to exactly width*height, identifying the map body as a full occupancy grid after base64 normalization.");
  }
  if ((analysis.payload.adjacentChanges.byteChangeRatio?.min ?? 0) > 0.5) {
    findings.push("Adjacent map payloads change heavily, which suggests snapshot-like encoded blocks rather than small movement-only deltas.");
  }
  if (analysis.rasterHypotheses.length > 0) {
    findings.push(`Best raster probe is ${analysis.rasterHypotheses[0].name} with structure score ${analysis.rasterHypotheses[0].structureScore}.`);
  }

  nextSteps.push("Use the LZ4 occupancy grid as the primary private map renderer and compare orientation/value colors against the app screenshot.");
  nextSteps.push("Use area and charger overlays as alignment anchors while refining no-go, dock, robot, and path rendering.");
  nextSteps.push("Record the base64 whitespace-to-plus normalization rule as a protocol finding before moving the decoder into adapter code.");

  return { findings, nextSteps };
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

function summarizeRange(values: number[]): NumberRange | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return values.reduce<NumberRange | undefined>((range, value) => mergeRange(range, value), undefined);
}

function mergeRange(range: NumberRange | undefined, value: number): NumberRange {
  if (!range) {
    return { min: value, max: value, count: 1 };
  }
  return {
    min: Math.min(range.min, value),
    max: Math.max(range.max, value),
    count: range.count + 1,
  };
}

function roundRatio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 1000;
}

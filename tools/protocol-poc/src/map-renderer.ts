import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { findLatestPrivateCapture } from "./capture-analysis.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = createCrcTable();
const PROBE_OFFSETS = [0, 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 64] as const;
const COORDINATE_PROBE_OFFSETS = [0, 16, 24, 32, 39, 40, 48, 64] as const;

export interface RenderMapOptions {
  capturePath: string;
  outputDirectory?: string;
  eventIndex?: number;
}

export interface RenderMapResult {
  captureFile: string;
  eventIndex: number;
  outputDirectory: string;
  files: string[];
  metadata: {
    width: number;
    height: number;
    resolution: number | undefined;
    encodedBytes: number;
    decodedBytes: number;
  };
  probes: {
    bitOffsetCount: number;
    coordinateOffsetCount: number;
    filteredCoordinateOffsetCount: number;
    evolutionContactSheets: string[];
    evolutionStats: EvolutionStats[];
    contactSheets: string[];
  };
  privacy: {
    outputContainsRawPayloads: false;
    notes: string[];
  };
}

interface MapSample {
  eventIndex: number;
  width: number;
  height: number;
  resolution: number | undefined;
  pathId: number | undefined;
  encoded: string;
}

export interface EvolutionStats {
  group: "all-events" | "latest-path";
  offset: number;
  events: number;
  uniquePoints: number;
  stablePoints: number;
  majorityPoints: number;
  transientPoints: number;
  stableRatio: number;
}

export async function renderLatestPrivateMap(): Promise<RenderMapResult> {
  return renderMapFromPrivateCapture({
    capturePath: await findLatestPrivateCapture(),
  });
}

export async function renderMapFromPrivateCapture(options: RenderMapOptions): Promise<RenderMapResult> {
  const samples = await readMapSamples(options.capturePath);
  const sample = selectMapSample(samples, options.capturePath, options.eventIndex);
  const outputDirectory = options.outputDirectory ?? join(dirname(options.capturePath), "rendered-maps", basename(options.capturePath, ".jsonl"));
  await mkdir(outputDirectory, { recursive: true });

  const decoded = Buffer.from(sample.encoded, "base64");
  const files: string[] = [];
  for (const offset of PROBE_OFFSETS) {
    const pixels = renderBitProbe(decoded, sample.width, sample.height, offset);
    const outputPath = join(outputDirectory, `event-${sample.eventIndex}-bit-offset-${offset}.png`);
    await writeFile(outputPath, encodeGrayscalePng(sample.width, sample.height, pixels));
    files.push(outputPath);
  }
  const coordinateFiles: string[] = [];
  const filteredCoordinateFiles: string[] = [];
  for (const offset of COORDINATE_PROBE_OFFSETS) {
    const pixels = renderCoordinatePointProbe(decoded, sample.width, sample.height, offset);
    const outputPath = join(outputDirectory, `event-${sample.eventIndex}-xy-points-offset-${offset}.png`);
    await writeFile(outputPath, encodeGrayscalePng(sample.width, sample.height, pixels));
    files.push(outputPath);
    coordinateFiles.push(outputPath);

    const filteredPixels = renderFilteredCoordinatePointProbe(decoded, sample.width, sample.height, offset);
    const filteredOutputPath = join(outputDirectory, `event-${sample.eventIndex}-xy-points-filtered-offset-${offset}.png`);
    await writeFile(filteredOutputPath, encodeGrayscalePng(sample.width, sample.height, filteredPixels));
    files.push(filteredOutputPath);
    filteredCoordinateFiles.push(filteredOutputPath);
  }

  const bitContactSheet = join(outputDirectory, `event-${sample.eventIndex}-bit-offsets-contact-sheet.png`);
  await writeFile(bitContactSheet, createContactSheet(
    PROBE_OFFSETS.map((offset) => renderBitProbe(decoded, sample.width, sample.height, offset)),
    sample.width,
    sample.height,
    4,
  ));
  files.push(bitContactSheet);

  const coordinateContactSheet = join(outputDirectory, `event-${sample.eventIndex}-xy-points-contact-sheet.png`);
  await writeFile(coordinateContactSheet, createContactSheet(
    COORDINATE_PROBE_OFFSETS.map((offset) => renderCoordinatePointProbe(decoded, sample.width, sample.height, offset)),
    sample.width,
    sample.height,
    4,
  ));
  files.push(coordinateContactSheet);

  const filteredCoordinateContactSheet = join(outputDirectory, `event-${sample.eventIndex}-xy-points-filtered-contact-sheet.png`);
  await writeFile(filteredCoordinateContactSheet, createContactSheet(
    COORDINATE_PROBE_OFFSETS.map((offset) => renderFilteredCoordinatePointProbe(decoded, sample.width, sample.height, offset)),
    sample.width,
    sample.height,
    4,
  ));
  files.push(filteredCoordinateContactSheet);

  const evolutionContactSheets: string[] = [];
  const evolutionStats: EvolutionStats[] = [];
  if (options.eventIndex === undefined && samples.length > 1) {
    const allEvolutionContactSheet = join(outputDirectory, "xy-points-evolution-all-events-contact-sheet.png");
    await writeFile(allEvolutionContactSheet, createContactSheet(
      COORDINATE_PROBE_OFFSETS.map((offset) => renderCoordinateEvolutionProbe(samples, offset)),
      sample.width,
      sample.height,
      4,
    ));
    files.push(allEvolutionContactSheet);
    evolutionContactSheets.push(allEvolutionContactSheet);
    evolutionStats.push(
      ...COORDINATE_PROBE_OFFSETS.map((offset) => coordinateEvolutionStats("all-events", samples, offset)),
    );

    const latestPathSamples = latestPathSegment(samples);
    if (latestPathSamples.length > 1 && latestPathSamples.length < samples.length) {
      const pathEvolutionContactSheet = join(outputDirectory, "xy-points-evolution-latest-path-contact-sheet.png");
      await writeFile(pathEvolutionContactSheet, createContactSheet(
        COORDINATE_PROBE_OFFSETS.map((offset) => renderCoordinateEvolutionProbe(latestPathSamples, offset)),
        sample.width,
        sample.height,
        4,
      ));
      files.push(pathEvolutionContactSheet);
      evolutionContactSheets.push(pathEvolutionContactSheet);
      evolutionStats.push(
        ...COORDINATE_PROBE_OFFSETS.map((offset) => coordinateEvolutionStats("latest-path", latestPathSamples, offset)),
      );
    }
  }

  return {
    captureFile: basename(options.capturePath),
    eventIndex: sample.eventIndex,
    outputDirectory,
    files,
    metadata: {
      width: sample.width,
      height: sample.height,
      resolution: sample.resolution,
      encodedBytes: Buffer.byteLength(sample.encoded, "utf8"),
      decodedBytes: decoded.length,
    },
    probes: {
      bitOffsetCount: PROBE_OFFSETS.length,
      coordinateOffsetCount: coordinateFiles.length,
      filteredCoordinateOffsetCount: filteredCoordinateFiles.length,
      evolutionContactSheets,
      evolutionStats,
      contactSheets: [bitContactSheet, coordinateContactSheet, filteredCoordinateContactSheet],
    },
    privacy: {
      outputContainsRawPayloads: false,
      notes: [
        "Rendered files are owner-local reverse-engineering probes and may reveal private home layout data.",
        "The renderer does not print raw map payloads, positions, serials, tokens, accounts, or endpoints.",
        "Generated map images must stay below ignored private paths and must not be committed or shared publicly.",
      ],
    },
  };
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
    if (!data) {
      continue;
    }
    const encoded = data.map;
    const width = data.width;
    const height = data.height;
    if (typeof encoded !== "string" || typeof width !== "number" || typeof height !== "number") {
      continue;
    }

    const eventIndex = typeof record.index === "number" ? record.index : 0;
    const sample = {
      eventIndex,
      width,
      height,
      resolution: typeof data.resolution === "number" ? data.resolution : undefined,
      pathId: typeof data.pathId === "number" ? data.pathId : undefined,
      encoded,
    };
    samples.push(sample);
  }

  return samples;
}

function selectMapSample(
  samples: MapSample[],
  capturePath: string,
  requestedEventIndex: number | undefined,
): MapSample {
  const selected = requestedEventIndex === undefined
    ? samples.at(-1)
    : samples.find((sample) => sample.eventIndex === requestedEventIndex);
  if (!selected) {
    const suffix = requestedEventIndex === undefined ? "" : ` for event ${requestedEventIndex}`;
    throw new Error(`No renderable infoType 20002 map payload found in ${capturePath}${suffix}`);
  }

  return selected;
}

function parseRecord(line: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed private records without copying their raw text.
  }
  return undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function renderBitProbe(bytes: Buffer, width: number, height: number, offset: number): Buffer {
  const pixels = Buffer.alloc(width * height, 0xff);
  let pixel = 0;
  for (let index = offset; index < bytes.length && pixel < pixels.length; index++) {
    const byte = bytes[index];
    for (let bit = 7; bit >= 0 && pixel < pixels.length; bit--) {
      pixels[pixel] = (byte >> bit) & 1 ? 0x24 : 0xf4;
      pixel += 1;
    }
  }
  return pixels;
}

function renderCoordinatePointProbe(bytes: Buffer, width: number, height: number, offset: number): Buffer {
  const pixels = Buffer.alloc(width * height, 0xf4);
  for (let index = offset; index + 1 < bytes.length; index += 2) {
    const x = bytes[index];
    const y = bytes[index + 1];
    if (x < width && y < height) {
      pixels[y * width + x] = 0x18;
    }
  }
  return pixels;
}

function renderFilteredCoordinatePointProbe(bytes: Buffer, width: number, height: number, offset: number): Buffer {
  const pixels = Buffer.alloc(width * height, 0xf4);
  for (let index = offset; index + 1 < bytes.length; index += 2) {
    const x = bytes[index];
    const y = bytes[index + 1];
    if (isRenderableCoordinate(x, y, width, height)) {
      plotThickPoint(pixels, width, height, x, y, 0x18);
    }
  }
  return pixels;
}

function renderCoordinateEvolutionProbe(samples: MapSample[], offset: number): Buffer {
  const reference = samples.at(-1);
  if (!reference) {
    throw new Error("No map samples available for coordinate evolution rendering");
  }

  const counts = new Uint16Array(reference.width * reference.height);
  for (const sample of samples) {
    const decoded = Buffer.from(sample.encoded, "base64");
    const seenInSample = new Set<number>();
    for (let index = offset; index + 1 < decoded.length; index += 2) {
      const x = decoded[index];
      const y = decoded[index + 1];
      if (isRenderableCoordinate(x, y, reference.width, reference.height)) {
        seenInSample.add(y * reference.width + x);
      }
    }
    for (const position of seenInSample) {
      counts[position] += 1;
    }
  }

  const pixels = Buffer.alloc(reference.width * reference.height, 0xf8);
  const sampleCount = samples.length;
  for (let index = 0; index < counts.length; index++) {
    const count = counts[index];
    if (count === 0) {
      continue;
    }
    if (count === sampleCount) {
      pixels[index] = 0x10;
      continue;
    }
    if (count >= Math.ceil(sampleCount / 2)) {
      pixels[index] = 0x60;
      continue;
    }
    pixels[index] = 0xb0;
  }

  return pixels;
}

function coordinateEvolutionStats(group: EvolutionStats["group"], samples: MapSample[], offset: number): EvolutionStats {
  const reference = samples.at(-1);
  if (!reference) {
    throw new Error("No map samples available for coordinate evolution stats");
  }

  const counts = coordinateOccurrenceCounts(samples, offset, reference.width, reference.height);
  let stablePoints = 0;
  let majorityPoints = 0;
  let transientPoints = 0;
  for (const count of counts.values()) {
    if (count === samples.length) {
      stablePoints += 1;
    } else if (count >= Math.ceil(samples.length / 2)) {
      majorityPoints += 1;
    } else {
      transientPoints += 1;
    }
  }

  return {
    group,
    offset,
    events: samples.length,
    uniquePoints: counts.size,
    stablePoints,
    majorityPoints,
    transientPoints,
    stableRatio: roundRatio(stablePoints, counts.size),
  };
}

function coordinateOccurrenceCounts(
  samples: MapSample[],
  offset: number,
  width: number,
  height: number,
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const sample of samples) {
    const decoded = Buffer.from(sample.encoded, "base64");
    const seenInSample = new Set<number>();
    for (let index = offset; index + 1 < decoded.length; index += 2) {
      const x = decoded[index];
      const y = decoded[index + 1];
      if (isRenderableCoordinate(x, y, width, height)) {
        seenInSample.add(y * width + x);
      }
    }
    for (const position of seenInSample) {
      counts.set(position, (counts.get(position) ?? 0) + 1);
    }
  }
  return counts;
}

function roundRatio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function latestPathSegment(samples: MapSample[]): MapSample[] {
  const latest = samples.at(-1);
  if (!latest) {
    return [];
  }

  const segment: MapSample[] = [];
  for (let index = samples.length - 1; index >= 0; index--) {
    const sample = samples[index];
    if (sample.pathId !== latest.pathId) {
      break;
    }
    segment.unshift(sample);
  }
  return segment;
}

function isRenderableCoordinate(x: number, y: number, width: number, height: number): boolean {
  if (x >= width || y >= height) {
    return false;
  }
  if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
    return false;
  }
  return x !== 0xff && y !== 0xff;
}

function plotThickPoint(
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  color: number,
): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (px >= 0 && px < width && py >= 0 && py < height) {
        pixels[py * width + px] = Math.min(pixels[py * width + px], color);
      }
    }
  }
}

function createContactSheet(images: Buffer[], imageWidth: number, imageHeight: number, columns: number): Buffer {
  const rows = Math.ceil(images.length / columns);
  const sheetWidth = imageWidth * columns;
  const sheetHeight = imageHeight * rows;
  const sheet = Buffer.alloc(sheetWidth * sheetHeight, 0xff);

  images.forEach((image, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    for (let y = 0; y < imageHeight; y++) {
      image.copy(
        sheet,
        (row * imageHeight + y) * sheetWidth + column * imageWidth,
        y * imageWidth,
        (y + 1) * imageWidth,
      );
    }
  });

  return encodeGrayscalePng(sheetWidth, sheetHeight, sheet);
}

export function encodeGrayscalePng(width: number, height: number, pixels: Buffer): Buffer {
  if (pixels.length !== width * height) {
    throw new Error(`Expected ${width * height} grayscale pixels but received ${pixels.length}`);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;

  const scanlines = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    scanlines[y * (width + 1)] = 0;
    pixels.copy(scanlines, y * (width + 1) + 1, y * width, (y + 1) * width);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable(): number[] {
  const table: number[] = [];
  for (let index = 0; index < 256; index++) {
    let crc = index;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }
  return table;
}

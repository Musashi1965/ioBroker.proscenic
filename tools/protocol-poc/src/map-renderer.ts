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
  encoded: string;
}

export async function renderLatestPrivateMap(): Promise<RenderMapResult> {
  return renderMapFromPrivateCapture({
    capturePath: await findLatestPrivateCapture(),
  });
}

export async function renderMapFromPrivateCapture(options: RenderMapOptions): Promise<RenderMapResult> {
  const sample = await readMapSample(options.capturePath, options.eventIndex);
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

async function readMapSample(capturePath: string, requestedEventIndex: number | undefined): Promise<MapSample> {
  const text = await readFile(capturePath, "utf8");
  let latest: MapSample | undefined;

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
      encoded,
    };
    if (requestedEventIndex === undefined || requestedEventIndex === eventIndex) {
      latest = sample;
    }
  }

  if (!latest) {
    const suffix = requestedEventIndex === undefined ? "" : ` for event ${requestedEventIndex}`;
    throw new Error(`No renderable infoType 20002 map payload found in ${capturePath}${suffix}`);
  }

  return latest;
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

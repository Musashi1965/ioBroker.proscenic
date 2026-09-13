import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { findLatestPrivateCapture } from "./capture-analysis.js";
import { decodeMapPayload, decompressLz4Block } from "./map-payload.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = createCrcTable();
const PROBE_OFFSETS = [0, 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 64] as const;
const COORDINATE_PROBE_OFFSETS = [0, 16, 24, 32, 39, 40, 48, 64] as const;
const RASTER_PROBE_OFFSETS = [32, 39, 40, 48, 64, 96, 128] as const;
const MAX_SEGMENT_CONTACT_SHEETS = 8;
const OCCUPANCY_ORIENTATIONS = ["raw", "flip-x", "flip-y", "flip-xy"] as const;

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
    decompressedBytes: number | undefined;
    areaCount: number;
    hasCoordinateMetadata: boolean;
    robotPoseCount: number;
    occupancyChangedCellsFromFirst: number | undefined;
  };
  probes: {
    bitOffsetCount: number;
    coordinateOffsetCount: number;
    filteredCoordinateOffsetCount: number;
    evolutionContactSheets: string[];
    evolutionStats: EvolutionStats[];
    candidateStats: CandidateStats[];
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
  xMin: number | undefined;
  yMin: number | undefined;
  pathId: number | undefined;
  areas: MapArea[];
  chargeHandlePos: [number, number] | undefined;
  encoded: string;
}

interface RobotPose {
  eventIndex: number;
  pos: [number, number];
  phi: number | undefined;
}

interface MapArea {
  vertices: Array<[number, number]>;
}

export interface EvolutionStats {
  group: "all-events" | "latest-path" | "path-segment";
  segment: string | undefined;
  offset: number;
  events: number;
  uniquePoints: number;
  stablePoints: number;
  majorityPoints: number;
  transientPoints: number;
  stableRatio: number;
}

export interface CandidateStats {
  name: string;
  offset: number;
  points: number;
  coverageRatio: number;
  components: number;
  largestComponentPoints: number;
  largestComponentRatio: number;
  structureScore: number;
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | undefined;
}

export async function renderLatestPrivateMap(): Promise<RenderMapResult> {
  return renderMapFromPrivateCapture({
    capturePath: await findLatestPrivateCapture(),
  });
}

export async function renderMapFromPrivateCapture(options: RenderMapOptions): Promise<RenderMapResult> {
  const samples = await readMapSamples(options.capturePath);
  const robotPoses = await readRobotPoses(options.capturePath);
  const sample = selectMapSample(samples, options.capturePath, options.eventIndex);
  const posesForSample = robotPoses.filter((pose) => pose.eventIndex <= sample.eventIndex);
  const outputDirectory = options.outputDirectory ?? join(dirname(options.capturePath), "rendered-maps", basename(options.capturePath, ".jsonl"));
  await mkdir(outputDirectory, { recursive: true });

  const decoded = decodeMapPayload(sample.encoded).compressed;
  const firstDecoded = decodeMapPayload(samples[0].encoded).compressed;
  const firstOccupancyGrid = decompressOccupancyGrid(firstDecoded, sample.width, sample.height);
  const selectedOccupancyGrid = decompressOccupancyGrid(decoded, sample.width, sample.height);
  const occupancyChangedCellsFromFirst = firstOccupancyGrid && selectedOccupancyGrid
    ? countChangedCells(firstOccupancyGrid, selectedOccupancyGrid)
    : undefined;
  const files: string[] = [];
  for (const offset of PROBE_OFFSETS) {
    const pixels = renderBitProbe(decoded, sample.width, sample.height, offset);
    const outputPath = join(outputDirectory, `event-${sample.eventIndex}-bit-offset-${offset}.png`);
    await writeFile(outputPath, encodeGrayscalePng(sample.width, sample.height, pixels));
    files.push(outputPath);
  }
  const coordinateFiles: string[] = [];
  const filteredCoordinateFiles: string[] = [];
  const candidateImages: Buffer[] = [];
  const candidateStats: CandidateStats[] = [];
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

    candidateImages.push(filteredPixels);
    candidateStats.push(scoreCandidate(`xy-u8-filtered-offset-${offset}`, offset, filteredPixels, sample.width, sample.height));

    const yxPixels = renderFilteredCoordinatePointProbe(decoded, sample.width, sample.height, offset, "yx");
    const yxOutputPath = join(outputDirectory, `event-${sample.eventIndex}-yx-points-filtered-offset-${offset}.png`);
    await writeFile(yxOutputPath, encodeGrayscalePng(sample.width, sample.height, yxPixels));
    files.push(yxOutputPath);
    candidateImages.push(yxPixels);
    candidateStats.push(scoreCandidate(`yx-u8-filtered-offset-${offset}`, offset, yxPixels, sample.width, sample.height));

    const walkPixels = renderSignedDeltaWalkProbe(decoded, sample.width, sample.height, offset);
    const walkOutputPath = join(outputDirectory, `event-${sample.eventIndex}-signed-delta-walk-offset-${offset}.png`);
    await writeFile(walkOutputPath, encodeGrayscalePng(sample.width, sample.height, walkPixels));
    files.push(walkOutputPath);
    candidateImages.push(walkPixels);
    candidateStats.push(scoreCandidate(`signed-delta-walk-offset-${offset}`, offset, walkPixels, sample.width, sample.height));
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

  const candidateContactSheet = join(outputDirectory, `event-${sample.eventIndex}-candidate-decoders-contact-sheet.png`);
  await writeFile(candidateContactSheet, createContactSheet(candidateImages, sample.width, sample.height, 4));
  files.push(candidateContactSheet);

  const occupancyMap = renderOccupancyMapProbe(decoded, sample.width, sample.height, "raw");
  if (occupancyMap) {
    const occupancyMapPath = join(outputDirectory, `event-${sample.eventIndex}-occupancy-map.png`);
    await writeFile(occupancyMapPath, encodeGrayscalePng(sample.width, sample.height, occupancyMap.pixels));
    files.push(occupancyMapPath);

    const occupancyOverlay = Buffer.from(occupancyMap.pixels);
    drawCoordinateMetadata(sample, occupancyOverlay);
    const occupancyOverlayPath = join(outputDirectory, `event-${sample.eventIndex}-occupancy-map-with-overlays.png`);
    await writeFile(occupancyOverlayPath, encodeGrayscalePng(sample.width, sample.height, occupancyOverlay));
    files.push(occupancyOverlayPath);

    for (const orientation of OCCUPANCY_ORIENTATIONS) {
      const orientedMap = renderOccupancyMapProbe(decoded, sample.width, sample.height, orientation);
      if (!orientedMap) {
        continue;
      }

      const orientedPath = join(outputDirectory, `event-${sample.eventIndex}-occupancy-map-${orientation}.png`);
      await writeFile(orientedPath, encodeGrayscalePng(sample.width, sample.height, orientedMap.pixels));
      files.push(orientedPath);

      const orientedOverlay = Buffer.from(orientedMap.pixels);
      drawCoordinateMetadata(sample, orientedOverlay);
      const orientedOverlayPath = join(outputDirectory, `event-${sample.eventIndex}-occupancy-map-${orientation}-with-overlays.png`);
      await writeFile(orientedOverlayPath, encodeGrayscalePng(sample.width, sample.height, orientedOverlay));
      files.push(orientedOverlayPath);

      const orientedRuntimeOverlay = Buffer.from(orientedMap.pixels);
      drawCoordinateMetadata(sample, orientedRuntimeOverlay);
      drawRobotRuntime(sample, orientedRuntimeOverlay, posesForSample);
      const orientedRuntimeOverlayPath = join(outputDirectory, `event-${sample.eventIndex}-occupancy-map-${orientation}-with-runtime-overlays.png`);
      await writeFile(orientedRuntimeOverlayPath, encodeGrayscalePng(sample.width, sample.height, orientedRuntimeOverlay));
      files.push(orientedRuntimeOverlayPath);

      if (orientation === "flip-y" && firstOccupancyGrid && selectedOccupancyGrid) {
        const orientedDeltaOverlay = Buffer.from(orientedMap.pixels);
        drawOccupancyDelta(orientedDeltaOverlay, firstOccupancyGrid, selectedOccupancyGrid, sample.width, sample.height, orientation);
        drawCoordinateMetadata(sample, orientedDeltaOverlay);
        drawRobotRuntime(sample, orientedDeltaOverlay, posesForSample);
        const orientedDeltaOverlayPath = join(outputDirectory, `event-${sample.eventIndex}-occupancy-map-${orientation}-with-delta-runtime-overlays.png`);
        await writeFile(orientedDeltaOverlayPath, encodeGrayscalePng(sample.width, sample.height, orientedDeltaOverlay));
        files.push(orientedDeltaOverlayPath);
      }
    }
  }

  const rasterProbeImages = rasterProbeSpecs(sample.width).flatMap((stride) => RASTER_PROBE_OFFSETS.map((offset) => (
    renderByteThresholdRasterProbe(decoded, sample.width, sample.height, stride, offset)
  )));
  const rasterProbeContactSheet = join(outputDirectory, `event-${sample.eventIndex}-byte-raster-contact-sheet.png`);
  await writeFile(rasterProbeContactSheet, createContactSheet(rasterProbeImages, sample.width, sample.height, 4));
  files.push(rasterProbeContactSheet);

  const metadataOverlay = renderCoordinateMetadataOverlay(sample);
  if (metadataOverlay) {
    const metadataOverlayPath = join(outputDirectory, `event-${sample.eventIndex}-coordinate-metadata-overlay.png`);
    await writeFile(metadataOverlayPath, encodeGrayscalePng(sample.width, sample.height, metadataOverlay));
    files.push(metadataOverlayPath);
  }

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
      ...COORDINATE_PROBE_OFFSETS.map((offset) => coordinateEvolutionStats("all-events", undefined, samples, offset)),
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
        ...COORDINATE_PROBE_OFFSETS.map((offset) => coordinateEvolutionStats("latest-path", segmentLabel(latestPathSamples), latestPathSamples, offset)),
      );
    }

    for (const segment of pathSegments(samples).slice(-MAX_SEGMENT_CONTACT_SHEETS)) {
      if (segment.samples.length <= 1) {
        continue;
      }

      const pathSegmentContactSheet = join(outputDirectory, `xy-points-evolution-${safeFilePart(segmentLabel(segment.samples))}-contact-sheet.png`);
      await writeFile(pathSegmentContactSheet, createContactSheet(
        COORDINATE_PROBE_OFFSETS.map((offset) => renderCoordinateEvolutionProbe(segment.samples, offset)),
        sample.width,
        sample.height,
        4,
      ));
      files.push(pathSegmentContactSheet);
      evolutionContactSheets.push(pathSegmentContactSheet);
      evolutionStats.push(
        ...COORDINATE_PROBE_OFFSETS.map((offset) => coordinateEvolutionStats("path-segment", segmentLabel(segment.samples), segment.samples, offset)),
      );
    }
  }

  candidateStats.sort((left, right) => right.structureScore - left.structureScore);

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
      decompressedBytes: occupancyMap?.decompressedBytes,
      areaCount: sample.areas.length,
      hasCoordinateMetadata: hasCoordinateMetadata(sample),
      robotPoseCount: posesForSample.length,
      occupancyChangedCellsFromFirst,
    },
    probes: {
      bitOffsetCount: PROBE_OFFSETS.length,
      coordinateOffsetCount: coordinateFiles.length,
      filteredCoordinateOffsetCount: filteredCoordinateFiles.length,
      evolutionContactSheets,
      evolutionStats,
      candidateStats,
      contactSheets: [bitContactSheet, coordinateContactSheet, filteredCoordinateContactSheet, candidateContactSheet, rasterProbeContactSheet],
    },
    privacy: {
      outputContainsRawPayloads: false,
      notes: [
        "Rendered files are owner-local reverse-engineering probes and may reveal private home layout data.",
        "The renderer does not print raw map payloads, positions, serials, tokens, accounts, or endpoints.",
        "Area and dock overlays are derived from coordinate metadata and may reveal private room layout details.",
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
      xMin: typeof data.x_min === "number" ? data.x_min : undefined,
      yMin: typeof data.y_min === "number" ? data.y_min : undefined,
      pathId: typeof data.pathId === "number" ? data.pathId : undefined,
      areas: parseMapAreas(data.area),
      chargeHandlePos: parsePoint(data.chargeHandlePos),
      encoded,
    };
    samples.push(sample);
  }

  return samples;
}

async function readRobotPoses(capturePath: string): Promise<RobotPose[]> {
  const text = await readFile(capturePath, "utf8");
  const poses: RobotPose[] = [];

  for (const line of text.split(/\r?\n/u)) {
    if (line.trim().length === 0) {
      continue;
    }
    const record = parseRecord(line);
    if (record?.kind !== "event" || record.infoType !== 20001) {
      continue;
    }

    const data = getRecord(getRecord(record.decrypted)?.data);
    const pos = parsePoint(data?.pos);
    if (!pos) {
      continue;
    }

    poses.push({
      eventIndex: typeof record.index === "number" ? record.index : poses.length + 1,
      pos,
      phi: typeof data?.phi === "number" ? data.phi : undefined,
    });
  }

  return poses;
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

function parseMapAreas(value: unknown): MapArea[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const areas: MapArea[] = [];
  for (const entry of value) {
    const record = getRecord(entry);
    if (!record || !Array.isArray(record.vertexs)) {
      continue;
    }

    const vertices = record.vertexs
      .map((vertex) => parsePoint(vertex))
      .filter((vertex): vertex is [number, number] => vertex !== undefined);
    if (vertices.length >= 3) {
      areas.push({ vertices });
    }
  }

  return areas;
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

function renderCoordinateMetadataOverlay(sample: MapSample): Buffer | undefined {
  if (!hasCoordinateMetadata(sample) || (sample.areas.length === 0 && !sample.chargeHandlePos)) {
    return undefined;
  }

  const pixels = Buffer.alloc(sample.width * sample.height, 0xf8);
  drawCoordinateMetadata(sample, pixels);
  return pixels;
}

function drawCoordinateMetadata(sample: MapSample, pixels: Buffer): void {
  for (const area of sample.areas) {
    const projected = area.vertices
      .map((vertex) => projectRobotCoordinate(sample, vertex))
      .filter((vertex): vertex is [number, number] => vertex !== undefined);
    if (projected.length >= 3) {
      fillPolygon(pixels, sample.width, sample.height, projected, 0xa8);
      drawPolygon(pixels, sample.width, sample.height, projected, 0x48);
    }
  }

  if (sample.chargeHandlePos) {
    const charge = projectRobotCoordinate(sample, sample.chargeHandlePos);
    if (charge) {
      plotMarker(pixels, sample.width, sample.height, charge[0], charge[1], 4, 0x10);
    }
  }
}

function drawRobotRuntime(sample: MapSample, pixels: Buffer, poses: RobotPose[]): void {
  const projected = poses
    .map((pose) => ({
      point: projectRobotCoordinate(sample, pose.pos),
      phi: pose.phi,
    }))
    .filter((pose): pose is { point: [number, number]; phi: number | undefined } => pose.point !== undefined);

  for (let index = 1; index < projected.length; index++) {
    const previous = projected[index - 1].point;
    const current = projected[index].point;
    if (distanceSquared(previous, current) <= 30 * 30) {
      drawLine(pixels, sample.width, sample.height, previous[0], previous[1], current[0], current[1], 0x70);
    }
  }

  const latest = projected.at(-1);
  if (!latest) {
    return;
  }

  plotMarker(pixels, sample.width, sample.height, latest.point[0], latest.point[1], 5, 0x00);
  if (latest.phi !== undefined) {
    const angle = latest.phi / 1000;
    const headingLength = 10;
    const endX = Math.round(latest.point[0] + Math.cos(angle) * headingLength);
    const endY = Math.round(latest.point[1] - Math.sin(angle) * headingLength);
    drawLine(pixels, sample.width, sample.height, latest.point[0], latest.point[1], endX, endY, 0x00);
  }
}

function distanceSquared(left: [number, number], right: [number, number]): number {
  return (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2;
}

function hasCoordinateMetadata(sample: MapSample): boolean {
  return sample.resolution !== undefined && sample.xMin !== undefined && sample.yMin !== undefined;
}

function projectRobotCoordinate(sample: MapSample, point: [number, number]): [number, number] | undefined {
  if (!hasCoordinateMetadata(sample) || sample.resolution === undefined || sample.xMin === undefined || sample.yMin === undefined) {
    return undefined;
  }

  const xMeters = point[0] / 1000;
  const yMeters = point[1] / 1000;
  const x = Math.round((xMeters - sample.xMin) / sample.resolution);
  const y = sample.height - 1 - Math.round((yMeters - sample.yMin) / sample.resolution);
  if (x < 0 || x >= sample.width || y < 0 || y >= sample.height) {
    return undefined;
  }
  return [x, y];
}

function fillPolygon(
  pixels: Buffer,
  width: number,
  height: number,
  polygon: Array<[number, number]>,
  color: number,
): void {
  const minY = Math.max(0, Math.min(...polygon.map(([, y]) => y)));
  const maxY = Math.min(height - 1, Math.max(...polygon.map(([, y]) => y)));

  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    for (let index = 0; index < polygon.length; index++) {
      const [x1, y1] = polygon[index];
      const [x2, y2] = polygon[(index + 1) % polygon.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        const x = x1 + ((y - y1) * (x2 - x1)) / (y2 - y1);
        intersections.push(Math.round(x));
      }
    }

    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const start = Math.max(0, intersections[index]);
      const end = Math.min(width - 1, intersections[index + 1]);
      for (let x = start; x <= end; x++) {
        pixels[y * width + x] = Math.min(pixels[y * width + x], color);
      }
    }
  }
}

function drawPolygon(
  pixels: Buffer,
  width: number,
  height: number,
  polygon: Array<[number, number]>,
  color: number,
): void {
  for (let index = 0; index < polygon.length; index++) {
    const [x1, y1] = polygon[index];
    const [x2, y2] = polygon[(index + 1) % polygon.length];
    drawLine(pixels, width, height, x1, y1, x2, y2, color);
  }
}

function drawLine(
  pixels: Buffer,
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: number,
): void {
  const dx = Math.abs(x2 - x1);
  const sx = x1 < x2 ? 1 : -1;
  const dy = -Math.abs(y2 - y1);
  const sy = y1 < y2 ? 1 : -1;
  let error = dx + dy;
  let x = x1;
  let y = y1;

  while (true) {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      pixels[y * width + x] = Math.min(pixels[y * width + x], color);
    }
    if (x === x2 && y === y2) {
      break;
    }
    const error2 = 2 * error;
    if (error2 >= dy) {
      error += dy;
      x += sx;
    }
    if (error2 <= dx) {
      error += dx;
      y += sy;
    }
  }
}

function plotMarker(
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
  color: number,
): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (px >= 0 && px < width && py >= 0 && py < height && dx * dx + dy * dy <= radius * radius) {
        pixels[py * width + px] = Math.min(pixels[py * width + px], color);
      }
    }
  }
}

function rasterProbeSpecs(width: number): number[] {
  return Array.from(new Set([
    width,
    width - 1,
    width + 1,
    Math.max(1, width - 5),
    128,
    200,
    256,
  ])).filter((stride) => stride > 0);
}

function renderByteThresholdRasterProbe(
  bytes: Buffer,
  width: number,
  height: number,
  stride: number,
  offset: number,
): Buffer {
  const pixels = Buffer.alloc(width * height, 0xf8);
  if (offset >= bytes.length) {
    return pixels;
  }

  const rows = Math.ceil((bytes.length - offset) / stride);
  for (let index = offset; index < bytes.length; index++) {
    const value = bytes[index];
    if (value === 0 || value === 0xff) {
      continue;
    }

    const cell = index - offset;
    const sourceX = cell % stride;
    const sourceY = Math.floor(cell / stride);
    const x = Math.min(width - 1, Math.floor((sourceX / stride) * width));
    const y = Math.min(height - 1, Math.floor((sourceY / rows) * height));
    pixels[y * width + x] = 0x28;
  }

  return pixels;
}

function renderOccupancyMapProbe(
  compressed: Buffer,
  width: number,
  height: number,
  orientation: (typeof OCCUPANCY_ORIENTATIONS)[number],
): { pixels: Buffer; decompressedBytes: number } | undefined {
  try {
    const occupancy = decompressOccupancyGrid(compressed, width, height);
    if (!occupancy) {
      return undefined;
    }

    const pixels = Buffer.alloc(width * height, 0xff);
    for (let index = 0; index < occupancy.length; index++) {
      const value = occupancy[index];
      const sourceX = index % width;
      const sourceY = Math.floor(index / width);
      const target = transformOccupancyPoint(sourceX, sourceY, width, height, orientation);
      const targetIndex = target[1] * width + target[0];
      if (value === 0) {
        pixels[targetIndex] = 0x28;
      } else if (value === 127) {
        pixels[targetIndex] = 0xb8;
      } else if (value === 255) {
        pixels[targetIndex] = 0xff;
      } else {
        pixels[targetIndex] = Math.max(0, Math.min(255, value));
      }
    }

    return {
      pixels,
      decompressedBytes: occupancy.length,
    };
  } catch {
    return undefined;
  }
}

function decompressOccupancyGrid(compressed: Buffer, width: number, height: number): Buffer | undefined {
  try {
    const occupancy = decompressLz4Block(compressed, width * height);
    return occupancy.length === width * height ? occupancy : undefined;
  } catch {
    return undefined;
  }
}

function countChangedCells(left: Buffer, right: Buffer): number {
  const limit = Math.min(left.length, right.length);
  let changes = Math.abs(left.length - right.length);
  for (let index = 0; index < limit; index++) {
    if (left[index] !== right[index]) {
      changes += 1;
    }
  }
  return changes;
}

function drawOccupancyDelta(
  pixels: Buffer,
  first: Buffer,
  current: Buffer,
  width: number,
  height: number,
  orientation: (typeof OCCUPANCY_ORIENTATIONS)[number],
): void {
  const limit = Math.min(first.length, current.length, width * height);
  for (let index = 0; index < limit; index++) {
    if (first[index] === current[index]) {
      continue;
    }
    const sourceX = index % width;
    const sourceY = Math.floor(index / width);
    const [x, y] = transformOccupancyPoint(sourceX, sourceY, width, height, orientation);
    plotMarker(pixels, width, height, x, y, 1, 0x00);
  }
}

function transformOccupancyPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  orientation: (typeof OCCUPANCY_ORIENTATIONS)[number],
): [number, number] {
  switch (orientation) {
    case "flip-x":
      return [width - 1 - x, y];
    case "flip-y":
      return [x, height - 1 - y];
    case "flip-xy":
      return [width - 1 - x, height - 1 - y];
    case "raw":
      return [x, y];
  }
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

function renderFilteredCoordinatePointProbe(
  bytes: Buffer,
  width: number,
  height: number,
  offset: number,
  order: "xy" | "yx" = "xy",
): Buffer {
  const pixels = Buffer.alloc(width * height, 0xf4);
  for (let index = offset; index + 1 < bytes.length; index += 2) {
    const x = order === "xy" ? bytes[index] : bytes[index + 1];
    const y = order === "xy" ? bytes[index + 1] : bytes[index];
    if (isRenderableCoordinate(x, y, width, height)) {
      plotThickPoint(pixels, width, height, x, y, 0x18);
    }
  }
  return pixels;
}

function renderSignedDeltaWalkProbe(bytes: Buffer, width: number, height: number, offset: number): Buffer {
  const pixels = Buffer.alloc(width * height, 0xf4);
  let x = Math.floor(width / 2);
  let y = Math.floor(height / 2);
  plotThickPoint(pixels, width, height, x, y, 0x18);
  for (let index = offset; index + 1 < bytes.length; index += 2) {
    const dx = bytes.readInt8(index);
    const dy = bytes.readInt8(index + 1);
    if (Math.abs(dx) > 32 || Math.abs(dy) > 32) {
      continue;
    }
    x = Math.max(1, Math.min(width - 2, x + dx));
    y = Math.max(1, Math.min(height - 2, y + dy));
    plotThickPoint(pixels, width, height, x, y, 0x18);
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
    const decoded = decodeMapPayload(sample.encoded).compressed;
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

function coordinateEvolutionStats(
  group: EvolutionStats["group"],
  segment: string | undefined,
  samples: MapSample[],
  offset: number,
): EvolutionStats {
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
    segment,
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
    const decoded = decodeMapPayload(sample.encoded).compressed;
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

function pathSegments(samples: MapSample[]): Array<{ samples: MapSample[] }> {
  const segments: Array<{ samples: MapSample[] }> = [];
  for (const sample of samples) {
    const current = segments.at(-1);
    if (current && current.samples.at(-1)?.pathId === sample.pathId) {
      current.samples.push(sample);
    } else {
      segments.push({ samples: [sample] });
    }
  }
  return segments;
}

function segmentLabel(samples: MapSample[]): string {
  const first = samples[0];
  const last = samples.at(-1);
  return `path-${String(last?.pathId ?? "unknown")}-events-${first?.eventIndex ?? 0}-${last?.eventIndex ?? 0}`;
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9._-]+/giu, "-").slice(0, 120);
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

function scoreCandidate(
  name: string,
  offset: number,
  pixels: Buffer,
  width: number,
  height: number,
): CandidateStats {
  const occupied = new Set<number>();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < pixels.length; index++) {
    if (pixels[index] >= 0xf4) {
      continue;
    }
    occupied.add(index);
    const x = index % width;
    const y = Math.floor(index / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const visited = new Set<number>();
  let components = 0;
  let largestComponentPoints = 0;
  for (const position of occupied) {
    if (visited.has(position)) {
      continue;
    }
    components += 1;
    const size = floodComponent(position, occupied, visited, width, height);
    largestComponentPoints = Math.max(largestComponentPoints, size);
  }

  const points = occupied.size;
  const coverageRatio = roundRatio(points, width * height);
  const largestComponentRatio = roundRatio(largestComponentPoints, points);
  const componentPenalty = components === 0 ? 0 : Math.min(1, components / Math.max(1, points));
  const densityPenalty = coverageRatio > 0.35 ? coverageRatio : 0;
  const structureScore = Math.round(Math.max(0, (largestComponentRatio - componentPenalty - densityPenalty) * 1000)) / 1000;

  return {
    name,
    offset,
    points,
    coverageRatio,
    components,
    largestComponentPoints,
    largestComponentRatio,
    structureScore,
    bounds: points === 0
      ? undefined
      : {
          minX,
          minY,
          maxX,
          maxY,
        },
  };
}

function floodComponent(
  start: number,
  occupied: Set<number>,
  visited: Set<number>,
  width: number,
  height: number,
): number {
  const queue = [start];
  visited.add(start);
  let size = 0;

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const position = queue[cursor];
    size += 1;
    const x = position % width;
    const y = Math.floor(position / width);
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const;
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
        continue;
      }
      const neighbor = ny * width + nx;
      if (occupied.has(neighbor) && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return size;
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

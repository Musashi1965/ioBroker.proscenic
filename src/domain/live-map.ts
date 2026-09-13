import { deflateSync } from "node:zlib";

export interface RobotPose {
	pos: [number, number];
	phi?: number;
}

export interface LiveMapImage {
	dataUrl: string;
	width: number;
	height: number;
	poseCount: number;
	orientation: "flip-y";
	decompressedBytes: number;
}

interface MapSample {
	encoded: string;
	width: number;
	height: number;
	resolution?: number;
	xMin?: number;
	yMin?: number;
	areas: MapArea[];
	chargeHandlePos?: [number, number];
}

interface MapArea {
	vertices: Array<[number, number]>;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = createCrcTable();
const MAX_LIVE_MAP_PIXELS = 512 * 512;
const MAX_LIVE_MAP_DATA_URL_BYTES = 256 * 1024;

export function extractRobotPose20001(data: unknown): RobotPose | undefined {
	const record = getRecord(data);
	const pos = parsePoint(record?.pos);
	if (!pos) {
		return undefined;
	}

	return {
		pos,
		phi: typeof record?.phi === "number" ? record.phi : undefined,
	};
}

export function renderLiveMapImage20002(data: unknown, poses: readonly RobotPose[] = []): LiveMapImage | undefined {
	const sample = parseMapSample(data);
	if (!sample) {
		return undefined;
	}

	const compressed = decodeMapPayload(sample.encoded);
	const occupancy = decompressLz4Block(compressed, sample.width * sample.height);
	if (occupancy.length !== sample.width * sample.height) {
		return undefined;
	}

	const pixels = renderOccupancy(sample.width, sample.height, occupancy);
	drawCoordinateMetadata(sample, pixels);
	const poseCount = drawRobotRuntime(sample, pixels, poses);

	const png = encodeGrayscalePng(sample.width, sample.height, pixels);
	const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
	if (Buffer.byteLength(dataUrl, "utf8") > MAX_LIVE_MAP_DATA_URL_BYTES) {
		return undefined;
	}

	return {
		dataUrl,
		width: sample.width,
		height: sample.height,
		poseCount,
		orientation: "flip-y",
		decompressedBytes: occupancy.length,
	};
}

function parseMapSample(data: unknown): MapSample | undefined {
	const record = getRecord(data);
	if (!record) {
		return undefined;
	}

	const encoded = record.map;
	const width = record.width;
	const height = record.height;
	if (typeof encoded !== "string" || typeof width !== "number" || typeof height !== "number") {
		return undefined;
	}
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
		return undefined;
	}
	if (width * height > MAX_LIVE_MAP_PIXELS) {
		return undefined;
	}

	return {
		encoded,
		width,
		height,
		resolution: typeof record.resolution === "number" ? record.resolution : undefined,
		xMin: typeof record.x_min === "number" ? record.x_min : undefined,
		yMin: typeof record.y_min === "number" ? record.y_min : undefined,
		areas: parseMapAreas(record.area),
		chargeHandlePos: parsePoint(record.chargeHandlePos),
	};
}

function renderOccupancy(width: number, height: number, occupancy: Buffer): Buffer {
	const pixels = Buffer.alloc(width * height, 0xff);
	for (let index = 0; index < occupancy.length; index++) {
		const sourceX = index % width;
		const sourceY = Math.floor(index / width);
		const targetY = height - 1 - sourceY;
		const targetIndex = targetY * width + sourceX;
		const value = occupancy[index];
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
	return pixels;
}

function drawCoordinateMetadata(sample: MapSample, pixels: Buffer): void {
	for (const area of sample.areas) {
		const projected = area.vertices
			.map(vertex => projectRobotCoordinate(sample, vertex))
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

function drawRobotRuntime(sample: MapSample, pixels: Buffer, poses: readonly RobotPose[]): number {
	const projected = poses
		.map(pose => ({
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
		return 0;
	}

	plotMarker(pixels, sample.width, sample.height, latest.point[0], latest.point[1], 5, 0x00);
	if (latest.phi !== undefined) {
		const angle = latest.phi / 1000;
		const headingLength = 10;
		const endX = Math.round(latest.point[0] + Math.cos(angle) * headingLength);
		const endY = Math.round(latest.point[1] - Math.sin(angle) * headingLength);
		drawLine(pixels, sample.width, sample.height, latest.point[0], latest.point[1], endX, endY, 0x00);
	}

	return projected.length;
}

function projectRobotCoordinate(sample: MapSample, point: [number, number]): [number, number] | undefined {
	if (sample.resolution === undefined || sample.xMin === undefined || sample.yMin === undefined) {
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
			.map(vertex => parsePoint(vertex))
			.filter((vertex): vertex is [number, number] => vertex !== undefined);
		if (vertices.length >= 3) {
			areas.push({ vertices });
		}
	}

	return areas;
}

function parsePoint(value: unknown): [number, number] | undefined {
	if (Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
		return [value[0], value[1]];
	}
	return undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function decodeMapPayload(encodedMap: string): Buffer {
	return Buffer.from(encodedMap.replace(/\s/gu, "+"), "base64");
}

function decompressLz4Block(input: Buffer, maxOutputBytes: number): Buffer {
	const output = Buffer.alloc(maxOutputBytes);
	let inputOffset = 0;
	let outputOffset = 0;

	while (inputOffset < input.length) {
		const token = input[inputOffset++];
		let literalLength = token >> 4;
		if (literalLength === 15) {
			let next: number;
			do {
				if (inputOffset >= input.length) {
					throw new Error("literal length overflow");
				}
				next = input[inputOffset++];
				literalLength += next;
			} while (next === 255);
		}

		if (inputOffset + literalLength > input.length || outputOffset + literalLength > output.length) {
			throw new Error("literal overrun");
		}
		input.copy(output, outputOffset, inputOffset, inputOffset + literalLength);
		inputOffset += literalLength;
		outputOffset += literalLength;

		if (inputOffset >= input.length) {
			break;
		}
		if (inputOffset + 2 > input.length) {
			throw new Error("offset overrun");
		}
		const matchOffset = input[inputOffset] | (input[inputOffset + 1] << 8);
		inputOffset += 2;
		if (matchOffset === 0 || matchOffset > outputOffset) {
			throw new Error("bad match offset");
		}

		let matchLength = token & 0x0f;
		if (matchLength === 15) {
			let next: number;
			do {
				if (inputOffset >= input.length) {
					throw new Error("match length overflow");
				}
				next = input[inputOffset++];
				matchLength += next;
			} while (next === 255);
		}
		matchLength += 4;
		if (outputOffset + matchLength > output.length) {
			throw new Error("match overrun");
		}
		for (let index = 0; index < matchLength; index++) {
			output[outputOffset + index] = output[outputOffset - matchOffset + index];
		}
		outputOffset += matchLength;
	}

	return output.subarray(0, outputOffset);
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

function distanceSquared(left: [number, number], right: [number, number]): number {
	return (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2;
}

function encodeGrayscalePng(width: number, height: number, pixels: Buffer): Buffer {
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

function createCrcTable(): readonly number[] {
	return Array.from({ length: 256 }, (_, index) => {
		let value = index;
		for (let bit = 0; bit < 8; bit++) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		return value >>> 0;
	});
}

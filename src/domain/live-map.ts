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
	rawPoseCount: number;
	pathLineSegments: number;
	skippedPathSegments: number;
	renderedForbiddenAreaCount: number;
	renderedRoomAreaCount: number;
	orientation: "flip-y";
	decompressedBytes: number;
}

export type LiveMapAreaKind = "forbidden" | "room" | "unknown";

export interface LiveMapAreaMetadata {
	key: string;
	kind: LiveMapAreaKind;
	source: Record<string, unknown>;
}

export interface LiveMapCoordinateMetadata {
	mapId?: number;
	area?: LiveMapAreaMetadata[];
	chargeHandlePos?: [number, number];
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
	kind: LiveMapAreaKind;
}

type Color = readonly [number, number, number];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = createCrcTable();
const MAX_LIVE_MAP_PIXELS = 512 * 512;
const MAX_LIVE_MAP_DATA_URL_BYTES = 256 * 1024;
const COLOR_UNKNOWN: Color = [184, 204, 216];
const COLOR_ROOM: Color = [255, 255, 255];
const COLOR_WALL: Color = [56, 130, 188];
const COLOR_OBSTACLE: Color = [82, 82, 82];
const COLOR_FORBIDDEN_AREA: Color = [209, 106, 133];
const COLOR_FORBIDDEN_OUTLINE: Color = [175, 68, 103];
const FORBIDDEN_AREA_ALPHA = 0.45;
const COLOR_ROOM_AREA: Color = [112, 125, 236];
const COLOR_ROOM_AREA_OUTLINE: Color = [68, 84, 210];
const ROOM_AREA_ALPHA = 0.3;
const COLOR_DOCK: Color = [92, 92, 92];
const COLOR_ROBOT: Color = [39, 139, 61];
const COLOR_PATH: Color = [126, 216, 96];
const COLOR_HEADING: Color = [20, 20, 20];
const MIN_PATH_SEGMENT_DISTANCE_SQUARED = 1.5 ** 2;
const MAX_PATH_SEGMENT_DISTANCE_SQUARED = 90 ** 2;
const ROUTED_PATH_PADDING_PIXELS = 24;
const MAX_ROUTED_PATH_CELLS = 20_000;
const PATH_LINE_RADIUS = 1;

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
	const coordinateMetadata = drawCoordinateMetadata(sample, pixels);
	const runtime = drawRobotRuntime(sample, occupancy, pixels, poses);

	const png = encodeRgbPng(sample.width, sample.height, pixels);
	const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
	if (Buffer.byteLength(dataUrl, "utf8") > MAX_LIVE_MAP_DATA_URL_BYTES) {
		return undefined;
	}

	return {
		dataUrl,
		width: sample.width,
		height: sample.height,
		poseCount: runtime.projectedPoseCount,
		rawPoseCount: poses.length,
		pathLineSegments: runtime.pathLineSegments,
		skippedPathSegments: runtime.skippedPathSegments,
		renderedForbiddenAreaCount: coordinateMetadata.renderedForbiddenAreaCount,
		renderedRoomAreaCount: coordinateMetadata.renderedRoomAreaCount,
		orientation: "flip-y",
		decompressedBytes: occupancy.length,
	};
}

export function extractLiveMapCoordinateMetadata20002(data: unknown): LiveMapCoordinateMetadata | undefined {
	const record = getRecord(data);
	if (!record) {
		return undefined;
	}

	const metadata: LiveMapCoordinateMetadata = {};
	if (typeof record.mapId === "number") {
		metadata.mapId = record.mapId;
	}
	const areas = normalizeMapAreaMetadata(record.area);
	if (areas.length > 0) {
		metadata.area = areas;
	}

	const chargeHandlePos = parsePoint(record.chargeHandlePos);
	if (chargeHandlePos) {
		metadata.chargeHandlePos = chargeHandlePos;
	}

	return metadata.mapId !== undefined || metadata.area !== undefined || metadata.chargeHandlePos !== undefined
		? metadata
		: undefined;
}

export function mergeLiveMapCoordinateMetadata20002(
	data: unknown,
	metadata: LiveMapCoordinateMetadata | undefined,
): unknown {
	const record = getRecord(data);
	if (!record || !metadata) {
		return data;
	}

	if (metadata.mapId !== undefined && typeof record.mapId === "number" && metadata.mapId !== record.mapId) {
		return data;
	}

	const merged = { ...record };
	if (metadata.area && metadata.area.length > 0) {
		merged.area = metadata.area.map(area => ({
			...area.source,
			__proscenicKind: area.kind,
		}));
	}
	if (metadata.chargeHandlePos && !parsePoint(record.chargeHandlePos)) {
		merged.chargeHandlePos = metadata.chargeHandlePos;
	}
	return merged;
}

export function countLiveMapAreas20002(data: unknown): number {
	const record = getRecord(data);
	return Array.isArray(record?.area) ? record.area.length : 0;
}

export function mergeLiveMapCoordinateMetadataCache(
	previous: LiveMapCoordinateMetadata | undefined,
	next: LiveMapCoordinateMetadata,
): LiveMapCoordinateMetadata {
	const sameMap = previous?.mapId === undefined || next.mapId === undefined || previous.mapId === next.mapId;
	const previousAreas = sameMap ? (previous?.area ?? []) : [];

	return {
		mapId: next.mapId ?? previous?.mapId,
		area: mergeAreaMetadata(previousAreas, next.area ?? []),
		chargeHandlePos: next.chargeHandlePos ?? (sameMap ? previous?.chargeHandlePos : undefined),
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
	const pixels = Buffer.alloc(width * height * 3);
	for (let index = 0; index < occupancy.length; index++) {
		const sourceX = index % width;
		const sourceY = Math.floor(index / width);
		const targetY = height - 1 - sourceY;
		const value = occupancy[index];
		if (value === 0) {
			setPixel(pixels, width, height, sourceX, targetY, COLOR_WALL);
		} else if (value === 127) {
			setPixel(pixels, width, height, sourceX, targetY, COLOR_ROOM);
		} else if (value === 255) {
			setPixel(pixels, width, height, sourceX, targetY, COLOR_UNKNOWN);
		} else {
			setPixel(pixels, width, height, sourceX, targetY, value < 127 ? COLOR_OBSTACLE : COLOR_ROOM);
		}
	}
	return pixels;
}

function drawCoordinateMetadata(
	sample: MapSample,
	pixels: Buffer,
): { renderedForbiddenAreaCount: number; renderedRoomAreaCount: number } {
	let renderedForbiddenAreaCount = 0;
	let renderedRoomAreaCount = 0;
	for (const area of sample.areas) {
		const projected = area.vertices
			.map(vertex => projectRobotCoordinate(sample, vertex))
			.filter((vertex): vertex is [number, number] => vertex !== undefined);
		if (projected.length >= 3) {
			if (area.kind === "room") {
				fillPolygon(pixels, sample.width, sample.height, projected, COLOR_ROOM_AREA, ROOM_AREA_ALPHA);
				drawPolygon(pixels, sample.width, sample.height, projected, COLOR_ROOM_AREA_OUTLINE);
				renderedRoomAreaCount += 1;
			} else {
				fillPolygon(pixels, sample.width, sample.height, projected, COLOR_FORBIDDEN_AREA, FORBIDDEN_AREA_ALPHA);
				drawPolygon(pixels, sample.width, sample.height, projected, COLOR_FORBIDDEN_OUTLINE);
				renderedForbiddenAreaCount += 1;
			}
		}
	}

	if (sample.chargeHandlePos) {
		const charge = projectRobotCoordinate(sample, sample.chargeHandlePos);
		if (charge) {
			plotMarker(pixels, sample.width, sample.height, charge[0], charge[1], 5, COLOR_DOCK);
		}
	}

	return { renderedForbiddenAreaCount, renderedRoomAreaCount };
}

function drawRobotRuntime(
	sample: MapSample,
	occupancy: Buffer,
	pixels: Buffer,
	poses: readonly RobotPose[],
): { projectedPoseCount: number; pathLineSegments: number; skippedPathSegments: number } {
	const projected = poses
		.map(pose => ({
			point: projectRobotCoordinate(sample, pose.pos),
			phi: pose.phi,
		}))
		.filter((pose): pose is { point: [number, number]; phi: number | undefined } => pose.point !== undefined);

	let pathLineSegments = 0;
	let skippedPathSegments = 0;

	for (let index = 1; index < projected.length; index++) {
		const previous = projected[index - 1].point;
		const current = projected[index].point;
		const segmentDistanceSquared = distanceSquared(previous, current);
		if (
			segmentDistanceSquared >= MIN_PATH_SEGMENT_DISTANCE_SQUARED &&
			segmentDistanceSquared <= MAX_PATH_SEGMENT_DISTANCE_SQUARED
		) {
			const routedPath = findDrawablePath(sample, occupancy, previous, current);
			if (routedPath) {
				drawAdaptivePathPolyline(sample, occupancy, pixels, sample.width, sample.height, routedPath);
				pathLineSegments += 1;
			} else {
				skippedPathSegments += 1;
			}
		} else {
			skippedPathSegments += 1;
		}
	}

	const latest = projected.at(-1);
	if (!latest) {
		return {
			projectedPoseCount: 0,
			pathLineSegments,
			skippedPathSegments,
		};
	}

	plotMarker(pixels, sample.width, sample.height, latest.point[0], latest.point[1], 5, COLOR_ROBOT);
	if (latest.phi !== undefined) {
		const angle = latest.phi / 1000;
		const headingLength = 10;
		const endX = Math.round(latest.point[0] + Math.cos(angle) * headingLength);
		const endY = Math.round(latest.point[1] - Math.sin(angle) * headingLength);
		drawLine(pixels, sample.width, sample.height, latest.point[0], latest.point[1], endX, endY, COLOR_HEADING);
	}

	return {
		projectedPoseCount: projected.length,
		pathLineSegments,
		skippedPathSegments,
	};
}

function drawAdaptivePathLine(
	pixels: Buffer,
	width: number,
	height: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	canDraw?: (x: number, y: number) => boolean,
): void {
	drawLineWithPixelColor(pixels, width, height, x1, y1, x2, y2, (x, y) =>
		canDraw && !canDraw(x, y) ? undefined : COLOR_PATH,
	);
	drawLineNeighbors(pixels, width, height, x1, y1, x2, y2, canDraw);
}

function drawAdaptivePathPolyline(
	sample: MapSample,
	occupancy: Buffer,
	pixels: Buffer,
	width: number,
	height: number,
	points: readonly [number, number][],
): void {
	const canDraw = (x: number, y: number): boolean => isTraversableMapPixel(sample, occupancy, x, y);
	for (let index = 1; index < points.length; index++) {
		const [x1, y1] = points[index - 1];
		const [x2, y2] = points[index];
		drawAdaptivePathLine(pixels, width, height, x1, y1, x2, y2, canDraw);
	}
}

function findDrawablePath(
	sample: MapSample,
	occupancy: Buffer,
	start: [number, number],
	end: [number, number],
): Array<[number, number]> | undefined {
	if (isDirectPathTraversable(sample, occupancy, start, end)) {
		return [start, end];
	}

	return findRoutedPath(sample, occupancy, start, end);
}

function isDirectPathTraversable(
	sample: MapSample,
	occupancy: Buffer,
	start: [number, number],
	end: [number, number],
): boolean {
	let traversedCells = 0;
	let blockedCells = 0;
	forEachLinePoint(start[0], start[1], end[0], end[1], (x, y) => {
		traversedCells += 1;
		if (!isTraversableMapPixel(sample, occupancy, x, y)) {
			blockedCells += 1;
		}
	});
	return traversedCells > 0 && blockedCells === 0;
}

function findRoutedPath(
	sample: MapSample,
	occupancy: Buffer,
	start: [number, number],
	end: [number, number],
): Array<[number, number]> | undefined {
	const routeStart = nearestTraversablePoint(sample, occupancy, start);
	const routeEnd = nearestTraversablePoint(sample, occupancy, end);
	if (!routeStart || !routeEnd) {
		return undefined;
	}

	const minX = Math.max(0, Math.min(routeStart[0], routeEnd[0]) - ROUTED_PATH_PADDING_PIXELS);
	const maxX = Math.min(sample.width - 1, Math.max(routeStart[0], routeEnd[0]) + ROUTED_PATH_PADDING_PIXELS);
	const minY = Math.max(0, Math.min(routeStart[1], routeEnd[1]) - ROUTED_PATH_PADDING_PIXELS);
	const maxY = Math.min(sample.height - 1, Math.max(routeStart[1], routeEnd[1]) + ROUTED_PATH_PADDING_PIXELS);
	const searchWidth = maxX - minX + 1;
	const searchHeight = maxY - minY + 1;
	if (searchWidth * searchHeight > MAX_ROUTED_PATH_CELLS) {
		return undefined;
	}

	const distance = new Map<number, number>();
	const previous = new Map<number, number>();
	const queue: Array<{ key: number; score: number }> = [];
	const startKey = localPointKey(routeStart[0], routeStart[1], minX, minY, searchWidth);
	const endKey = localPointKey(routeEnd[0], routeEnd[1], minX, minY, searchWidth);
	distance.set(startKey, 0);
	queue.push({ key: startKey, score: heuristic(routeStart, routeEnd) });

	while (queue.length > 0) {
		queue.sort((left, right) => left.score - right.score);
		const current = queue.shift();
		if (!current) {
			break;
		}
		if (current.key === endKey) {
			return restoreRoutedPath(previous, current.key, minX, minY, searchWidth);
		}

		const [currentX, currentY] = pointFromLocalKey(current.key, minX, minY, searchWidth);
		const currentDistance = distance.get(current.key) ?? Number.POSITIVE_INFINITY;
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				if (dx === 0 && dy === 0) {
					continue;
				}
				const nextX = currentX + dx;
				const nextY = currentY + dy;
				if (
					nextX < minX ||
					nextX > maxX ||
					nextY < minY ||
					nextY > maxY ||
					!isTraversableMapPixel(sample, occupancy, nextX, nextY)
				) {
					continue;
				}

				const nextKey = localPointKey(nextX, nextY, minX, minY, searchWidth);
				const nextDistance = currentDistance + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
				if (nextDistance >= (distance.get(nextKey) ?? Number.POSITIVE_INFINITY)) {
					continue;
				}
				distance.set(nextKey, nextDistance);
				previous.set(nextKey, current.key);
				queue.push({ key: nextKey, score: nextDistance + heuristic([nextX, nextY], routeEnd) });
			}
		}
	}

	return undefined;
}

function restoreRoutedPath(
	previous: ReadonlyMap<number, number>,
	endKey: number,
	minX: number,
	minY: number,
	width: number,
): Array<[number, number]> {
	const keys = [endKey];
	let current = endKey;
	while (previous.has(current)) {
		current = previous.get(current) ?? current;
		keys.push(current);
	}
	return simplifyPath(keys.reverse().map(key => pointFromLocalKey(key, minX, minY, width)));
}

function simplifyPath(points: Array<[number, number]>): Array<[number, number]> {
	if (points.length <= 2) {
		return points;
	}
	const simplified: Array<[number, number]> = [points[0]];
	let previousDirection: [number, number] | undefined;
	for (let index = 1; index < points.length; index++) {
		const direction: [number, number] = [
			Math.sign(points[index][0] - points[index - 1][0]),
			Math.sign(points[index][1] - points[index - 1][1]),
		];
		if (previousDirection && (direction[0] !== previousDirection[0] || direction[1] !== previousDirection[1])) {
			simplified.push(points[index - 1]);
		}
		previousDirection = direction;
	}
	simplified.push(points.at(-1) ?? points[0]);
	return simplified;
}

function nearestTraversablePoint(
	sample: MapSample,
	occupancy: Buffer,
	point: [number, number],
): [number, number] | undefined {
	if (isTraversableMapPixel(sample, occupancy, point[0], point[1])) {
		return point;
	}
	for (let radius = 1; radius <= 3; radius++) {
		for (let y = point[1] - radius; y <= point[1] + radius; y++) {
			for (let x = point[0] - radius; x <= point[0] + radius; x++) {
				if (isTraversableMapPixel(sample, occupancy, x, y)) {
					return [x, y];
				}
			}
		}
	}
	return undefined;
}

function isTraversableMapPixel(sample: MapSample, occupancy: Buffer, x: number, y: number): boolean {
	if (x < 0 || x >= sample.width || y < 0 || y >= sample.height) {
		return false;
	}
	const sourceY = sample.height - 1 - y;
	const value = occupancy[sourceY * sample.width + x];
	return value >= 127;
}

function localPointKey(x: number, y: number, minX: number, minY: number, width: number): number {
	return (y - minY) * width + (x - minX);
}

function pointFromLocalKey(key: number, minX: number, minY: number, width: number): [number, number] {
	return [minX + (key % width), minY + Math.floor(key / width)];
}

function heuristic(left: [number, number], right: [number, number]): number {
	return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function drawLineNeighbors(
	pixels: Buffer,
	width: number,
	height: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	canDraw?: (x: number, y: number) => boolean,
): void {
	for (let dy = -PATH_LINE_RADIUS; dy <= PATH_LINE_RADIUS; dy++) {
		for (let dx = -PATH_LINE_RADIUS; dx <= PATH_LINE_RADIUS; dx++) {
			if ((dx === 0 && dy === 0) || dx * dx + dy * dy > PATH_LINE_RADIUS * PATH_LINE_RADIUS) {
				continue;
			}
			drawLineWithPixelColor(pixels, width, height, x1 + dx, y1 + dy, x2 + dx, y2 + dy, (x, y) =>
				canDraw && !canDraw(x, y) ? undefined : COLOR_PATH,
			);
		}
	}
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
	return normalizeMapAreaMetadata(value).map(area => ({
		vertices: parseVertices(area.source.vertexs),
		kind: area.kind,
	}));
}

function normalizeMapAreaMetadata(value: unknown): LiveMapAreaMetadata[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const candidates = value
		.map(entry => {
			const record = getRecord(entry);
			if (!record) {
				return undefined;
			}
			const vertices = parseVertices(record.vertexs);
			if (vertices.length < 3) {
				return undefined;
			}
			const key = mapAreaKey(record, vertices);
			const explicitKind = parseAreaKind(record.__proscenicKind);
			return {
				key,
				explicitKind,
				source: record,
			};
		})
		.filter(
			(
				entry,
			): entry is {
				key: string;
				explicitKind: LiveMapAreaKind | undefined;
				source: Record<string, unknown>;
			} => entry !== undefined,
		);

	const counts = new Map<string, number>();
	for (const candidate of candidates) {
		counts.set(candidate.key, (counts.get(candidate.key) ?? 0) + 1);
	}

	const normalized = new Map<string, LiveMapAreaMetadata>();
	for (const candidate of candidates) {
		const kind =
			candidate.explicitKind ??
			(counts.get(candidate.key) !== undefined && (counts.get(candidate.key) ?? 0) > 1
				? "forbidden"
				: candidates.length === 1
					? "forbidden"
					: "room");
		const existing = normalized.get(candidate.key);
		const next = {
			key: candidate.key,
			kind,
			source: withoutInternalAreaMetadata(candidate.source),
		};
		normalized.set(candidate.key, existing ? mergeAreaMetadataEntry(existing, next) : next);
	}

	return [...normalized.values()];
}

function mergeAreaMetadata(
	previous: readonly LiveMapAreaMetadata[],
	next: readonly LiveMapAreaMetadata[],
): LiveMapAreaMetadata[] {
	const merged = new Map<string, LiveMapAreaMetadata>();
	for (const area of [...previous, ...next]) {
		const existing = merged.get(area.key);
		merged.set(area.key, existing ? mergeAreaMetadataEntry(existing, area) : area);
	}
	return [...merged.values()];
}

function mergeAreaMetadataEntry(left: LiveMapAreaMetadata, right: LiveMapAreaMetadata): LiveMapAreaMetadata {
	return {
		key: right.key,
		kind: strongestAreaKind(left.kind, right.kind),
		source: right.source,
	};
}

function strongestAreaKind(left: LiveMapAreaKind, right: LiveMapAreaKind): LiveMapAreaKind {
	if (left === "forbidden" || right === "forbidden") {
		return "forbidden";
	}
	if (left === "room" || right === "room") {
		return "room";
	}
	return "unknown";
}

function parseAreaKind(value: unknown): LiveMapAreaKind | undefined {
	return value === "forbidden" || value === "room" || value === "unknown" ? value : undefined;
}

function withoutInternalAreaMetadata(record: Record<string, unknown>): Record<string, unknown> {
	const clone = { ...record };
	delete clone.__proscenicKind;
	return clone;
}

function parseVertices(value: unknown): Array<[number, number]> {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map(vertex => parsePoint(vertex)).filter((vertex): vertex is [number, number] => vertex !== undefined);
}

function mapAreaKey(record: Record<string, unknown>, vertices: readonly [number, number][]): string {
	const id = record.id;
	if (typeof id === "number" || typeof id === "string") {
		return `id:${String(id)}`;
	}
	const xs = vertices.map(([x]) => x);
	const ys = vertices.map(([, y]) => y);
	return `shape:${vertices.length}:${Math.min(...xs)}:${Math.min(...ys)}:${Math.max(...xs)}:${Math.max(...ys)}`;
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
	color: Color,
	alpha = 1,
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
				blendPixel(pixels, width, height, x, y, color, alpha);
			}
		}
	}
}

function drawPolygon(
	pixels: Buffer,
	width: number,
	height: number,
	polygon: Array<[number, number]>,
	color: Color,
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
	color: Color,
): void {
	drawLineWithPixelColor(pixels, width, height, x1, y1, x2, y2, () => color);
}

function forEachLinePoint(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	callback: (x: number, y: number) => void,
): void {
	const dx = Math.abs(x2 - x1);
	const sx = x1 < x2 ? 1 : -1;
	const dy = -Math.abs(y2 - y1);
	const sy = y1 < y2 ? 1 : -1;
	let error = dx + dy;
	let x = x1;
	let y = y1;

	while (true) {
		callback(x, y);
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

function drawLineWithPixelColor(
	pixels: Buffer,
	width: number,
	height: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	pickColor: (x: number, y: number) => Color | undefined,
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
			const color = pickColor(x, y);
			if (color) {
				setPixel(pixels, width, height, x, y, color);
			}
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
	color: Color,
): void {
	for (let dy = -radius; dy <= radius; dy++) {
		for (let dx = -radius; dx <= radius; dx++) {
			const px = x + dx;
			const py = y + dy;
			if (px >= 0 && px < width && py >= 0 && py < height && dx * dx + dy * dy <= radius * radius) {
				setPixel(pixels, width, height, px, py, color);
			}
		}
	}
}

function setPixel(pixels: Buffer, width: number, height: number, x: number, y: number, color: Color): void {
	if (x < 0 || x >= width || y < 0 || y >= height) {
		return;
	}

	const offset = (y * width + x) * 3;
	pixels[offset] = color[0];
	pixels[offset + 1] = color[1];
	pixels[offset + 2] = color[2];
}

function blendPixel(
	pixels: Buffer,
	width: number,
	height: number,
	x: number,
	y: number,
	color: Color,
	alpha: number,
): void {
	if (alpha >= 1) {
		setPixel(pixels, width, height, x, y, color);
		return;
	}
	if (x < 0 || x >= width || y < 0 || y >= height) {
		return;
	}

	const offset = (y * width + x) * 3;
	pixels[offset] = Math.round(pixels[offset] * (1 - alpha) + color[0] * alpha);
	pixels[offset + 1] = Math.round(pixels[offset + 1] * (1 - alpha) + color[1] * alpha);
	pixels[offset + 2] = Math.round(pixels[offset + 2] * (1 - alpha) + color[2] * alpha);
}

function distanceSquared(left: [number, number], right: [number, number]): number {
	return (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2;
}

function encodeRgbPng(width: number, height: number, pixels: Buffer): Buffer {
	if (pixels.length !== width * height * 3) {
		throw new Error(`Expected ${width * height * 3} RGB pixels but received ${pixels.length}`);
	}

	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 2;

	const rowBytes = width * 3;
	const scanlines = Buffer.alloc((rowBytes + 1) * height);
	for (let y = 0; y < height; y++) {
		scanlines[y * (rowBytes + 1)] = 0;
		pixels.copy(scanlines, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
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

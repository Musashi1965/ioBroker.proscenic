export interface MapMetadata {
	available: boolean;
	mapId?: number;
	pathId?: number;
	width?: number;
	height?: number;
	resolution?: number;
	areaCount?: number;
	compressedBytes?: number;
	encodedBytes?: number;
}

export function normalizeMap20002(data: unknown): MapMetadata | undefined {
	if (data === null || typeof data !== "object" || Array.isArray(data)) {
		return undefined;
	}

	const record = data as Record<string, unknown>;
	const metadata: MapMetadata = {
		available: typeof record.map === "string" && record.map.length > 0,
	};

	copyNumber(record, metadata, "mapId", "mapId");
	copyNumber(record, metadata, "pathId", "pathId");
	copyNumber(record, metadata, "width", "width");
	copyNumber(record, metadata, "height", "height");
	copyNumber(record, metadata, "resolution", "resolution");
	copyNumber(record, metadata, "lz4_len", "compressedBytes");

	if (Array.isArray(record.area)) {
		metadata.areaCount = record.area.length;
	}
	if (typeof record.map === "string") {
		metadata.encodedBytes = Buffer.byteLength(record.map, "utf8");
	}

	return hasUsefulMapMetadata(metadata) ? metadata : undefined;
}

function hasUsefulMapMetadata(metadata: MapMetadata): boolean {
	return (
		metadata.available ||
		metadata.mapId !== undefined ||
		metadata.pathId !== undefined ||
		metadata.width !== undefined ||
		metadata.height !== undefined ||
		metadata.resolution !== undefined ||
		metadata.areaCount !== undefined ||
		metadata.compressedBytes !== undefined ||
		metadata.encodedBytes !== undefined
	);
}

function copyNumber<T extends object>(
	source: Record<string, unknown>,
	target: T,
	sourceKey: string,
	targetKey: keyof T & string,
): void {
	if (typeof source[sourceKey] === "number") {
		Object.assign(target, { [targetKey]: source[sourceKey] });
	}
}

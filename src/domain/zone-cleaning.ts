import type { CommandRequest } from "./commands";
import type { LiveMapCoordinateMetadata } from "./live-map";

const MAX_SELECTED_ZONES = 20;
const MAX_ZONE_LABEL_LENGTH = 128;

export interface ZoneCleaningSelection {
	mapId: number;
	zoneIds: number[];
}

export interface ZoneCleaningOption {
	id: number;
	label?: string;
}

const ACCEPTED_ZONE_CLEANING_RESULTS = new Set(["api-accepted", "api-accepted-unconfirmed", "status-confirmed"]);

export function shouldRecoverPendingZoneCleaningSelection(
	selectedZoneCount: number,
	selectionChangedAtMs: number | undefined,
	lastCommand: unknown,
	lastResult: unknown,
	lastExecution: unknown,
): boolean {
	if (
		selectedZoneCount <= 0 ||
		selectionChangedAtMs === undefined ||
		lastCommand !== "zoneCleaning" ||
		typeof lastResult !== "string" ||
		!ACCEPTED_ZONE_CLEANING_RESULTS.has(lastResult) ||
		typeof lastExecution !== "string"
	) {
		return false;
	}

	const executionAtMs = Date.parse(lastExecution);
	return Number.isFinite(executionAtMs) && executionAtMs >= selectionChangedAtMs;
}

export function normalizeZoneSelection(value: ioBroker.StateValue | undefined): number[] | undefined {
	if (value === null || value === undefined) {
		return [];
	}
	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	if (trimmed === "") {
		return [];
	}

	let parsed: unknown;
	try {
		parsed = trimmed.startsWith("[") ? JSON.parse(trimmed) : trimmed.split(",").map(entry => entry.trim());
	} catch {
		return undefined;
	}
	if (!Array.isArray(parsed) || parsed.length > MAX_SELECTED_ZONES) {
		return undefined;
	}

	const ids: number[] = [];
	for (const candidate of parsed) {
		const id = typeof candidate === "number" ? candidate : Number(candidate);
		if (!Number.isSafeInteger(id) || id < 0 || ids.includes(id)) {
			return undefined;
		}
		ids.push(id);
	}
	return ids;
}

export function zoneCleaningOptions(catalog: LiveMapCoordinateMetadata | undefined): ZoneCleaningOption[] {
	return (catalog?.area ?? []).flatMap(area => {
		if (area.kind !== "zone") {
			return [];
		}
		const id = normalizeZoneId(area.source.id);
		if (id === undefined) {
			return [];
		}
		const label = firstLabel(area.source.name, area.source.tag);
		return [{ id, ...(label ? { label } : {}) }];
	});
}

export function validateZoneCleaningSelection(
	zoneIds: readonly number[],
	mapId: number | undefined,
	catalog: LiveMapCoordinateMetadata | undefined,
): ZoneCleaningSelection {
	if (zoneIds.length === 0) {
		throw new Error("No map zones are selected");
	}
	if (!Number.isSafeInteger(mapId) || (mapId as number) < 0) {
		throw new Error("No active map is available for zone cleaning");
	}
	if (catalog?.mapId !== mapId) {
		throw new Error("The map zone catalog does not match the active map");
	}

	const available = new Set(zoneCleaningOptions(catalog).map(option => option.id));
	if (zoneIds.some(id => !available.has(id))) {
		throw new Error("The selected map zones are no longer available");
	}

	return { mapId: mapId as number, zoneIds: [...zoneIds] };
}

export function buildZoneCleaningRequest(
	selection: ZoneCleaningSelection,
	serial: string,
	username: string,
): CommandRequest {
	return {
		path: `/instructions/cmd30000/${encodeURIComponent(serial)}/${selection.mapId}?username=${encodeURIComponent(username)}&part=true`,
		contentType: "application/json;charset=UTF-8",
		body: JSON.stringify(selection.zoneIds),
	};
}

function normalizeZoneId(value: unknown): number | undefined {
	const id = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
	return Number.isSafeInteger(id) && id >= 0 ? id : undefined;
}

function firstLabel(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.trim() !== "") {
			return value
				.trim()
				.replace(/[\p{Cc}\p{Cf}]/gu, " ")
				.slice(0, MAX_ZONE_LABEL_LENGTH);
		}
	}
	return undefined;
}

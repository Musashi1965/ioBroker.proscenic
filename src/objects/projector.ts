import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConsumableComponent, ConsumableStates } from "../domain/consumables";
import type { MaintenanceHistory, MaintenanceMessage } from "../domain/maintenance-message";
import type { MapMetadata } from "../domain/map";
import type { LiveMapImage } from "../domain/live-map";
import type { RobotActivity, RobotStatus } from "../domain/status";
import type { ZoneCleaningOption } from "../domain/zone-cleaning";
import type { DeviceRecord } from "../protocol/types";

export interface LiveMapProjectionDiagnostics {
	renderReason: "map" | "pose" | "zones";
	lastPathId?: number;
	pathResetCount: number;
	lastPoseUpdated?: string;
	currentAreaCount: number;
	cachedAreaCount: number;
	hasCachedStaticOverlays: boolean;
}

export async function initializeLiveMapAreaStates(adapter: ioBroker.Adapter): Promise<void> {
	await adapter.setStateAsync("map.live.areas", { val: "[]", ack: true });
	await adapter.setStateAsync("map.live.areaSource", { val: "21004", ack: true });
	await adapter.setStateAsync("map.live.zoneCatalogUpdated", { val: "", ack: true });
	await adapter.setStateAsync("map.live.zoneCatalogLastReadResult", { val: "pending", ack: true });
	await adapter.setStateAsync("map.live.zoneCatalogLastError", { val: "", ack: true });
	await adapter.setStateAsync("map.live.currentAreaCount", { val: 0, ack: true });
	await adapter.setStateAsync("map.live.cachedAreaCount", { val: 0, ack: true });
	await adapter.setStateAsync("map.live.renderedForbiddenAreaCount", { val: 0, ack: true });
	await adapter.setStateAsync("map.live.renderedZoneAreaCount", { val: 0, ack: true });
	await adapter.setStateAsync("map.live.renderedRoomAreaCount", { val: 0, ack: true });
}

export async function projectMapZoneCatalogReadSuccess(adapter: ioBroker.Adapter, count: number): Promise<void> {
	await adapter.setStateAsync("map.live.areaSource", { val: "21004", ack: true });
	await adapter.setStateAsync("map.live.zoneCatalogUpdated", { val: new Date().toISOString(), ack: true });
	await adapter.setStateAsync("map.live.zoneCatalogLastReadResult", { val: "ok", ack: true });
	await adapter.setStateAsync("map.live.zoneCatalogLastError", { val: "", ack: true });
	await adapter.setStateAsync("map.live.currentAreaCount", { val: count, ack: true });
	await adapter.setStateAsync("map.live.cachedAreaCount", { val: count, ack: true });
}

export async function setMapZoneCatalogReadFailure(adapter: ioBroker.Adapter, error: unknown): Promise<void> {
	await adapter.setStateAsync("map.live.zoneCatalogLastReadResult", { val: "failed", ack: true });
	await adapter.setStateAsync("map.live.zoneCatalogLastError", {
		val: redactedErrorMessage(error),
		ack: true,
	});
}

export async function setInitialCapabilityStates(adapter: ioBroker.Adapter): Promise<void> {
	await adapter.setStateAsync("capabilities.statusRead", { val: true, ack: true });
	await adapter.setStateAsync("capabilities.commands", { val: false, ack: true });
	await adapter.setStateAsync("capabilities.zoneCleaning", { val: false, ack: true });
	await adapter.setStateAsync("capabilities.maps", { val: false, ack: true });
	await adapter.setStateAsync("capabilities.consumables", { val: false, ack: true });
	await adapter.setStateAsync("capabilities.consumableReset", { val: false, ack: true });
	await adapter.setStateAsync("capabilities.maintenanceMessages", { val: false, ack: true });
}

export async function projectZoneCleaningCatalog(
	adapter: ioBroker.Adapter,
	options: readonly ZoneCleaningOption[],
	available: boolean,
): Promise<void> {
	await adapter.setStateAsync("commands.zones.available", { val: JSON.stringify(options), ack: true });
	await adapter.setStateAsync("capabilities.zoneCleaning", { val: available, ack: true });
}

const LIVE_MAP_VIEWER_REVISION = "20260921-3";

export function liveMapViewerUrl(instance: number | undefined): string {
	const safeInstance = typeof instance === "number" && Number.isSafeInteger(instance) && instance >= 0 ? instance : 0;
	return `/proscenic/map-viewer/?instance=${safeInstance}&revision=${LIVE_MAP_VIEWER_REVISION}`;
}

export async function projectLiveMapViewerUrl(adapter: ioBroker.Adapter): Promise<void> {
	await adapter.setStateAsync("map.live.viewerUrl", { val: liveMapViewerUrl(adapter.instance), ack: true });
}

export async function projectDevice(adapter: ioBroker.Adapter, device: DeviceRecord): Promise<void> {
	await setIfDefined(adapter, "device.code", displayDeviceCode(device.code));
	await setIfDefined(adapter, "device.model", device.model);
	await setIfDefined(adapter, "device.online", device.status);
	await adapter.setStateAsync("device.onlineUpdated", { val: new Date().toISOString(), ack: true });
	await setDeviceOnlineStale(adapter, false);
	await adapter.setStateAsync("device.image", { val: deviceImageDataUrl(device), ack: true });
}

export async function setDeviceOnlineStale(adapter: ioBroker.Adapter, stale: boolean): Promise<void> {
	await adapter.setStateAsync("device.onlineFresh", { val: !stale, ack: true });
	await adapter.setStateAsync("device.onlineStale", { val: stale, ack: true });
}

export async function projectStatus(adapter: ioBroker.Adapter, status: RobotStatus): Promise<void> {
	await setIfDefined(adapter, "status.mode", status.mode);
	await setIfDefined(adapter, "status.subMode", status.subMode);
	await setIfDefined(adapter, "status.clean.area", status.cleanArea);
	await setIfDefined(adapter, "status.clean.time", status.cleanTime);
	await setIfDefined(adapter, "status.clean.totalArea", status.totalArea);
	await setIfDefined(adapter, "status.clean.totalTime", status.totalTime);
	await setIfDefined(adapter, "status.battery.percent", status.batteryPercent);
	await setIfDefined(adapter, "status.battery.rawPercent", status.batteryRawPercent);
	await setIfDefined(adapter, "status.water.level", status.waterLevel);
	await setIfDefined(adapter, "status.mop.mode", status.mopMode);
	await setIfDefined(adapter, "status.fan.mode", status.fanMode);
	await setIfDefined(adapter, "status.error.rawCount", status.errorRawCount);
	await setIfDefined(adapter, "status.maintenance.hasWarning", status.maintenanceWarning);
	await setIfDefined(adapter, "status.maintenance.warningCount", status.maintenanceWarningCount);
	await setIfDefined(adapter, "status.maintenance.message", status.maintenanceMessage);
	await setIfDefined(adapter, "status.maintenance.details", status.maintenanceDetails);
	await setIfDefined(adapter, "status.features.autoBoost", status.autoBoost);
	await setIfDefined(adapter, "status.features.cleanComponents", status.cleanComponents);
	await adapter.setStateAsync("connection.lastStatusEvent", { val: new Date().toISOString(), ack: true });
}

export async function projectRobotActivity(adapter: ioBroker.Adapter, activity: RobotActivity): Promise<void> {
	await adapter.setStateAsync("status.activity", { val: activity, ack: true });
}

export async function projectMaintenanceMessage(
	adapter: ioBroker.Adapter,
	message: MaintenanceMessage,
	eventCount: number,
): Promise<void> {
	// 20003 also contains ordinary events. Level 1 is shared by informational
	// and warning messages; receipt alone must not set or clear an active alarm.
	await setIfDefined(adapter, "status.maintenance.code", message.code);
	await setIfDefined(adapter, "status.maintenance.level", message.level);
	await setIfDefined(adapter, "status.maintenance.message", message.message ?? message.title ?? "");
	await adapter.setStateAsync("status.maintenance.details", { val: message.details, ack: true });
	await adapter.setStateAsync("status.maintenance.eventCount", { val: eventCount, ack: true });
	await adapter.setStateAsync("status.maintenance.updated", { val: new Date().toISOString(), ack: true });
}

export async function projectMaintenanceHistory(adapter: ioBroker.Adapter, history: MaintenanceHistory): Promise<void> {
	const latest = history.messages[0];
	if (latest) {
		await setIfDefined(adapter, "status.maintenance.history.latestCode", latest.code);
		await setIfDefined(adapter, "status.maintenance.history.latestLevel", latest.level);
		await setIfDefined(adapter, "status.maintenance.history.latestMessage", latest.message ?? latest.title ?? "");
		await setIfDefined(adapter, "status.maintenance.history.latestEventTime", latest.eventTime);
	}
	await adapter.setStateAsync("status.maintenance.history.items", {
		val: JSON.stringify(history.messages.map(historyMessageItem)),
		ack: true,
	});
	await adapter.setStateAsync("status.maintenance.history.count", { val: history.messages.length, ack: true });
	await setIfDefined(adapter, "status.maintenance.history.totalCount", history.totalElements);
	await adapter.setStateAsync("status.maintenance.history.updated", { val: new Date().toISOString(), ack: true });
	await adapter.setStateAsync("status.maintenance.history.lastReadResult", { val: "ok", ack: true });
	await adapter.setStateAsync("status.maintenance.history.lastError", { val: "", ack: true });
	await adapter.setStateAsync("capabilities.maintenanceMessages", { val: true, ack: true });
}

export async function projectConsumables(adapter: ioBroker.Adapter, consumables: ConsumableStates): Promise<void> {
	for (const [component, state] of Object.entries(consumables)) {
		const prefix = `consumables.${component}`;
		await adapter.setStateAsync(`${prefix}.usedSeconds`, { val: state.usedSeconds, ack: true });
		await adapter.setStateAsync(`${prefix}.intervalHours`, { val: state.intervalHours, ack: true });
		await adapter.setStateAsync(`${prefix}.remainingPercent`, { val: state.remainingPercent, ack: true });
		await adapter.setStateAsync(`${prefix}.overdueHours`, { val: state.overdueHours, ack: true });
	}
	await adapter.setStateAsync("consumables.updated", { val: new Date().toISOString(), ack: true });
	await adapter.setStateAsync("consumables.lastReadResult", { val: "ok", ack: true });
	await adapter.setStateAsync("consumables.lastError", { val: "", ack: true });
	await adapter.setStateAsync("capabilities.consumables", { val: true, ack: true });
}

export async function setConsumablesReadFailure(adapter: ioBroker.Adapter, error: unknown): Promise<void> {
	await adapter.setStateAsync("consumables.lastReadResult", { val: "failed", ack: true });
	await adapter.setStateAsync("consumables.lastError", { val: redactedErrorMessage(error), ack: true });
}

export async function setConsumableResetCapability(adapter: ioBroker.Adapter, available: boolean): Promise<void> {
	await adapter.setStateAsync("capabilities.consumableReset", { val: available, ack: true });
}

export async function projectConsumableResetProgress(
	adapter: ioBroker.Adapter,
	component: ConsumableComponent,
	result: string,
): Promise<void> {
	await adapter.setStateAsync("consumables.reset.lastComponent", { val: component, ack: true });
	await adapter.setStateAsync("consumables.reset.lastResult", { val: result, ack: true });
	await adapter.setStateAsync("consumables.reset.lastError", { val: "", ack: true });
	await adapter.setStateAsync("consumables.reset.lastExecution", { val: new Date().toISOString(), ack: true });
}

export async function setConsumableResetFailure(
	adapter: ioBroker.Adapter,
	component: ConsumableComponent,
	error: unknown,
): Promise<void> {
	await adapter.setStateAsync("consumables.reset.lastComponent", { val: component, ack: true });
	await adapter.setStateAsync("consumables.reset.lastResult", { val: "failed", ack: true });
	await adapter.setStateAsync("consumables.reset.lastError", { val: redactedErrorMessage(error), ack: true });
	await adapter.setStateAsync("consumables.reset.lastExecution", { val: new Date().toISOString(), ack: true });
}

export async function setMaintenanceHistoryReadFailure(adapter: ioBroker.Adapter, error: unknown): Promise<void> {
	await adapter.setStateAsync("status.maintenance.history.lastReadResult", { val: "failed", ack: true });
	await adapter.setStateAsync("status.maintenance.history.lastError", {
		val: redactedErrorMessage(error),
		ack: true,
	});
}

export async function projectMapMetadata(adapter: ioBroker.Adapter, map: MapMetadata): Promise<void> {
	await setIfDefined(adapter, "map.available", map.available);
	await setIfDefined(adapter, "map.id", map.mapId);
	await setIfDefined(adapter, "map.pathId", map.pathId);
	await setIfDefined(adapter, "map.width", map.width);
	await setIfDefined(adapter, "map.height", map.height);
	await setIfDefined(adapter, "map.resolution", map.resolution);
	await setIfDefined(adapter, "map.areaCount", map.areaCount);
	await setIfDefined(adapter, "map.compressedBytes", map.compressedBytes);
	await setIfDefined(adapter, "map.encodedBytes", map.encodedBytes);
	await adapter.setStateAsync("map.updated", { val: new Date().toISOString(), ack: true });
	await adapter.setStateAsync("capabilities.maps", { val: true, ack: true });
}

function historyMessageItem(message: MaintenanceMessage): Record<string, string | number> {
	return {
		...(message.code !== undefined ? { code: message.code } : {}),
		...(message.level !== undefined ? { level: message.level } : {}),
		...(message.title !== undefined ? { title: message.title } : {}),
		...(message.message !== undefined ? { message: message.message } : {}),
		...(message.eventTime !== undefined ? { eventTime: message.eventTime } : {}),
	};
}

export async function projectLiveMapImage(
	adapter: ioBroker.Adapter,
	image: LiveMapImage,
	diagnostics: LiveMapProjectionDiagnostics,
): Promise<void> {
	await adapter.setStateAsync("map.live.image", { val: image.dataUrl, ack: true });
	await adapter.setStateAsync("map.live.svgDataUri", { val: image.svgDataUrl, ack: true });
	await adapter.setStateAsync("map.live.pngDataUri", { val: image.pngDataUrl, ack: true });
	await adapter.setStateAsync("map.live.format", { val: image.format, ack: true });
	await adapter.setStateAsync("map.live.areas", { val: JSON.stringify(image.areas), ack: true });
	await adapter.setStateAsync("map.live.updated", { val: new Date().toISOString(), ack: true });
	await adapter.setStateAsync("map.live.orientation", { val: image.orientation, ack: true });
	await adapter.setStateAsync("map.live.poseCount", { val: image.poseCount, ack: true });
	await adapter.setStateAsync("map.live.rawPoseCount", { val: image.rawPoseCount, ack: true });
	await adapter.setStateAsync("map.live.pathLineSegments", { val: image.pathLineSegments, ack: true });
	await adapter.setStateAsync("map.live.skippedPathSegments", { val: image.skippedPathSegments, ack: true });
	await adapter.setStateAsync("map.live.currentAreaCount", { val: diagnostics.currentAreaCount, ack: true });
	await adapter.setStateAsync("map.live.cachedAreaCount", { val: diagnostics.cachedAreaCount, ack: true });
	await adapter.setStateAsync("map.live.renderedForbiddenAreaCount", {
		val: image.renderedForbiddenAreaCount,
		ack: true,
	});
	await adapter.setStateAsync("map.live.renderedZoneAreaCount", { val: image.renderedZoneAreaCount, ack: true });
	await adapter.setStateAsync("map.live.renderedRoomAreaCount", { val: image.renderedRoomAreaCount, ack: true });
	await adapter.setStateAsync("map.live.hasCachedStaticOverlays", {
		val: diagnostics.hasCachedStaticOverlays,
		ack: true,
	});
	await adapter.setStateAsync("map.live.renderReason", { val: diagnostics.renderReason, ack: true });
	await setIfDefined(adapter, "map.live.lastPathId", diagnostics.lastPathId);
	await adapter.setStateAsync("map.live.pathResetCount", { val: diagnostics.pathResetCount, ack: true });
	await adapter.setStateAsync("map.live.lastPoseUpdated", { val: diagnostics.lastPoseUpdated ?? "", ack: true });
	await adapter.setStateAsync("map.live.decompressedBytes", { val: image.decompressedBytes, ack: true });
	await adapter.setStateAsync("capabilities.maps", { val: true, ack: true });
}

export async function setConnectionState(
	adapter: ioBroker.Adapter,
	id: "cloud" | "gateway",
	connected: boolean,
): Promise<void> {
	await adapter.setStateAsync(`connection.${id}`, { val: connected, ack: true });
	if (id === "cloud") {
		await adapter.setStateAsync("info.connection", { val: connected, ack: true });
	}
}

export async function setDeviceListDiagnostics(
	adapter: ioBroker.Adapter,
	count: number,
	result: "pending" | "ok" | "empty" | "not-configured" | "failed",
): Promise<void> {
	await adapter.setStateAsync("connection.lastDeviceListCount", { val: count, ack: true });
	await adapter.setStateAsync("connection.lastDeviceListResult", { val: result, ack: true });
	await adapter.setStateAsync("connection.lastDeviceListUpdate", { val: new Date().toISOString(), ack: true });
}

export async function setLastError(adapter: ioBroker.Adapter, error: unknown): Promise<void> {
	await adapter.setStateAsync("connection.lastError", { val: redactedErrorMessage(error), ack: true });
}

export function redactedErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message
		.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu, "<redacted-email>")
		.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/gu, "<redacted-address>")
		.replace(/\b[a-z0-9.-]+\.[a-z]{2,}(?::\d{1,5})?\b/giu, "<redacted-host>");
}

async function setIfDefined(
	adapter: ioBroker.Adapter,
	id: string,
	value: string | number | boolean | undefined,
): Promise<void> {
	if (value !== undefined) {
		await adapter.setStateAsync(id, { val: value, ack: true });
	}
}

let cachedM7ProImageDataUrl: string | undefined;

function deviceImageDataUrl(device: DeviceRecord): string {
	if (device.code !== "M7_PRO" || device.model !== "811_LDS") {
		return "";
	}

	cachedM7ProImageDataUrl ??= readAssetDataUrl("proscenic-m7-pro.png");
	return cachedM7ProImageDataUrl;
}

function displayDeviceCode(code: string | undefined): string | undefined {
	return code ? `PROSCENIC ${code}` : undefined;
}

function readAssetDataUrl(fileName: string): string {
	for (const candidate of [
		join(__dirname, "..", "admin", fileName),
		join(__dirname, "..", "..", "admin", fileName),
	]) {
		if (existsSync(candidate)) {
			return `data:image/png;base64,${readFileSync(candidate).toString("base64")}`;
		}
	}
	return "";
}

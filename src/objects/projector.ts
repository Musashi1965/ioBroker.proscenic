import type { RobotStatus } from "../domain/status";
import type { DeviceRecord } from "../protocol/types";

export async function setInitialCapabilityStates(adapter: ioBroker.Adapter): Promise<void> {
	await adapter.setStateAsync("capabilities.statusRead", { val: true, ack: true });
	await adapter.setStateAsync("capabilities.commands", { val: false, ack: true });
	await adapter.setStateAsync("capabilities.maps", { val: false, ack: true });
}

export async function projectDevice(adapter: ioBroker.Adapter, device: DeviceRecord): Promise<void> {
	await setIfDefined(adapter, "device.code", device.code);
	await setIfDefined(adapter, "device.model", device.model);
	await setIfDefined(adapter, "device.online", device.status);
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
	await setIfDefined(adapter, "status.features.autoBoost", status.autoBoost);
	await setIfDefined(adapter, "status.features.cleanComponents", status.cleanComponents);
	await adapter.setStateAsync("connection.lastStatusEvent", { val: new Date().toISOString(), ack: true });
}

export async function setConnectionState(
	adapter: ioBroker.Adapter,
	id: "cloud" | "gateway",
	connected: boolean,
): Promise<void> {
	await adapter.setStateAsync(`connection.${id}`, { val: connected, ack: true });
	if (id === "gateway") {
		await adapter.setStateAsync("info.connection", { val: connected, ack: true });
	}
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

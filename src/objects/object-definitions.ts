export interface StateDefinition {
	id: string;
	object: ioBroker.StateObject;
}

export interface ChannelDefinition {
	id: string;
	object: ioBroker.ChannelObject;
}

export const CHANNEL_DEFINITIONS: readonly ChannelDefinition[] = [
	channel("device", "Selected device"),
	channel("connection", "Connection"),
	channel("capabilities", "Capabilities"),
	channel("status", "Status"),
	channel("status.clean", "Cleaning"),
	channel("status.battery", "Battery"),
	channel("status.water", "Water"),
	channel("status.mop", "Mop"),
	channel("status.fan", "Fan"),
	channel("status.error", "Error"),
	channel("status.features", "Features"),
];

export const STATE_DEFINITIONS: readonly StateDefinition[] = [
	state("device.code", "Device code", "string", "info.name"),
	state("device.model", "Device model", "string", "info.name"),
	state("device.online", "Device online", "boolean", "indicator.reachable"),
	state("connection.cloud", "Cloud connected", "boolean", "indicator.connected"),
	state("connection.gateway", "Gateway connected", "boolean", "indicator.connected"),
	state("connection.lastError", "Last redacted error", "string", "text"),
	state("connection.lastStatusEvent", "Last status event", "string", "date"),
	state("capabilities.statusRead", "Read status", "boolean", "indicator"),
	state("capabilities.commands", "Commands exposed", "boolean", "indicator"),
	state("capabilities.maps", "Maps exposed", "boolean", "indicator"),
	state("status.mode", "Mode", "string", "state"),
	state("status.subMode", "Sub mode", "string", "state"),
	state("status.clean.area", "Cleaning area", "number", "value", { unit: "m²", min: 0 }),
	state("status.clean.time", "Cleaning time", "number", "value", { unit: "s", min: 0 }),
	state("status.clean.totalArea", "Total cleaning area", "number", "value", { min: 0 }),
	state("status.clean.totalTime", "Total cleaning time", "number", "value", { unit: "s", min: 0 }),
	state("status.battery.percent", "Battery", "number", "value.battery", { unit: "%", min: 0, max: 100 }),
	state("status.battery.rawPercent", "Raw battery", "number", "value.battery", { unit: "%", min: 0, max: 100 }),
	state("status.water.level", "Water level", "number", "level", { min: 0 }),
	state("status.mop.mode", "Mop mode", "number", "state", { min: 0 }),
	state("status.fan.mode", "Fan mode", "string", "state"),
	state("status.error.rawCount", "Raw error count", "number", "value", { min: 0 }),
	state("status.features.autoBoost", "Auto boost", "boolean", "indicator"),
	state("status.features.cleanComponents", "Clean components", "boolean", "indicator"),
];

export async function extendAdapterObjects(adapter: ioBroker.Adapter): Promise<void> {
	for (const definition of CHANNEL_DEFINITIONS) {
		await adapter.setObjectNotExistsAsync(definition.id, definition.object);
	}

	for (const definition of STATE_DEFINITIONS) {
		await adapter.setObjectNotExistsAsync(definition.id, definition.object);
	}
}

function channel(id: string, name: string): ChannelDefinition {
	return {
		id,
		object: {
			_id: id,
			type: "channel",
			common: {
				name,
			},
			native: {},
		},
	};
}

function state(
	id: string,
	name: string,
	type: ioBroker.CommonType,
	role: string,
	options: Partial<ioBroker.StateCommon> = {},
): StateDefinition {
	return {
		id,
		object: {
			_id: id,
			type: "state",
			common: {
				name,
				type,
				role,
				read: true,
				write: false,
				...options,
			},
			native: {},
		},
	};
}

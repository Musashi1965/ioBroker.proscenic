import type { CommandDefinition } from "../domain/commands";
import { COMMAND_DEFINITIONS } from "../domain/commands";

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
	channel("consumables", "Consumables"),
	channel("consumables.filter", "Filter"),
	channel("consumables.sideBrush", "Side brush"),
	channel("consumables.mainBrush", "Main brush"),
	channel("consumables.sensors", "Sensors"),
	channel("status", "Status"),
	channel("status.clean", "Cleaning"),
	channel("status.battery", "Battery"),
	channel("status.water", "Water"),
	channel("status.mop", "Mop"),
	channel("status.fan", "Fan"),
	channel("status.error", "Error"),
	channel("status.features", "Features"),
	channel("status.maintenance", "Maintenance"),
	channel("status.maintenance.history", "Maintenance message history"),
	channel("map", "Map metadata"),
	channel("map.live", "Experimental live map"),
	channel("commands", "Commands"),
	channel("commands.fan", "Fan commands"),
];

export const STATE_DEFINITIONS: readonly StateDefinition[] = [
	state("device.code", "Device code", "string", "info.name"),
	state("device.model", "Device model", "string", "info.name"),
	state("device.online", "Device online", "boolean", "indicator.reachable"),
	state("device.image", "Device image", "string", "text"),
	state("connection.cloud", "Cloud connected", "boolean", "indicator.connected"),
	state("connection.gateway", "Gateway connected", "boolean", "indicator.connected"),
	state("connection.lastError", "Last redacted error", "string", "text"),
	state("connection.lastStatusEvent", "Last status event", "string", "date"),
	state("capabilities.statusRead", "Read status", "boolean", "indicator"),
	state("capabilities.commands", "Commands exposed", "boolean", "indicator"),
	state("capabilities.maps", "Maps exposed", "boolean", "indicator"),
	state("capabilities.consumables", "Consumables exposed", "boolean", "indicator"),
	state("capabilities.maintenanceMessages", "Maintenance messages exposed", "boolean", "indicator"),
	...consumableStates("consumables.filter", "Filter"),
	...consumableStates("consumables.sideBrush", "Side brush"),
	...consumableStates("consumables.mainBrush", "Main brush"),
	...consumableStates("consumables.sensors", "Sensors"),
	state("consumables.updated", "Last consumables update", "string", "date"),
	state("consumables.lastReadResult", "Last consumables read result", "string", "text"),
	state("consumables.lastError", "Last consumables read error", "string", "text"),
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
	state("status.maintenance.hasWarning", "Has maintenance warning", "boolean", "indicator"),
	state("status.maintenance.warningCount", "Maintenance warning count", "number", "value", { min: 0 }),
	state("status.maintenance.code", "Last maintenance event code", "number", "value"),
	state("status.maintenance.level", "Last maintenance event level", "number", "value", { min: 0 }),
	state("status.maintenance.message", "Maintenance message", "string", "text"),
	state("status.maintenance.details", "Maintenance details", "string", "text"),
	state("status.maintenance.eventCount", "Maintenance event count", "number", "value", { min: 0 }),
	state("status.maintenance.updated", "Last maintenance event update", "string", "date"),
	state("status.maintenance.history.items", "Maintenance message history", "string", "json"),
	state("status.maintenance.history.count", "Maintenance message history count", "number", "value", { min: 0 }),
	state("status.maintenance.history.totalCount", "Total maintenance message count", "number", "value", { min: 0 }),
	state("status.maintenance.history.latestCode", "Latest maintenance history code", "number", "value"),
	state("status.maintenance.history.latestLevel", "Latest maintenance history level", "number", "value", { min: 0 }),
	state("status.maintenance.history.latestMessage", "Latest maintenance history message", "string", "text"),
	state("status.maintenance.history.latestEventTime", "Latest maintenance history event time", "string", "date"),
	state("status.maintenance.history.updated", "Last maintenance message history update", "string", "date"),
	state(
		"status.maintenance.history.lastReadResult",
		"Last maintenance message history read result",
		"string",
		"text",
	),
	state("status.maintenance.history.lastError", "Last maintenance message history read error", "string", "text"),
	state("status.features.autoBoost", "Auto boost", "boolean", "indicator"),
	state("status.features.cleanComponents", "Clean components", "boolean", "indicator"),
	state("map.available", "Map data available", "boolean", "indicator"),
	state("map.id", "Map ID", "number", "value", { min: 0 }),
	state("map.pathId", "Path ID", "number", "value", { min: 0 }),
	state("map.width", "Map width", "number", "value", { min: 0 }),
	state("map.height", "Map height", "number", "value", { min: 0 }),
	state("map.resolution", "Map resolution", "number", "value", { min: 0 }),
	state("map.areaCount", "Map area count", "number", "value", { min: 0 }),
	state("map.compressedBytes", "Compressed map bytes", "number", "value", { unit: "B", min: 0 }),
	state("map.encodedBytes", "Encoded map bytes", "number", "value", { unit: "B", min: 0 }),
	state("map.updated", "Last map metadata update", "string", "date"),
	state("map.live.image", "Experimental live map image", "string", "text"),
	state("map.live.areas", "Experimental live map areas", "string", "json"),
	state("map.live.updated", "Last live map image update", "string", "date"),
	state("map.live.orientation", "Live map orientation", "string", "state"),
	state("map.live.poseCount", "Live map pose count", "number", "value", { min: 0 }),
	state("map.live.rawPoseCount", "Raw live map pose count", "number", "value", { min: 0 }),
	state("map.live.pathLineSegments", "Live map path line segments", "number", "value", { min: 0 }),
	state("map.live.skippedPathSegments", "Skipped live map path segments", "number", "value", { min: 0 }),
	state("map.live.currentAreaCount", "Current live map area count", "number", "value", { min: 0 }),
	state("map.live.cachedAreaCount", "Cached live map area count", "number", "value", { min: 0 }),
	state("map.live.renderedForbiddenAreaCount", "Rendered forbidden area count", "number", "value", { min: 0 }),
	state("map.live.renderedRoomAreaCount", "Rendered room area count", "number", "value", { min: 0 }),
	state("map.live.hasCachedStaticOverlays", "Has cached static live map overlays", "boolean", "indicator"),
	state("map.live.renderReason", "Last live map render reason", "string", "state"),
	state("map.live.lastPathId", "Last live map path ID", "number", "value", { min: 0 }),
	state("map.live.pathResetCount", "Live map path reset count", "number", "value", { min: 0 }),
	state("map.live.lastPoseUpdated", "Last live map pose update", "string", "date"),
	state("map.live.decompressedBytes", "Live map decompressed bytes", "number", "value", { unit: "B", min: 0 }),
	...COMMAND_DEFINITIONS.map(definition => commandButton(definition)),
	state("commands.lastCommand", "Last command", "string", "text"),
	state("commands.lastResult", "Last command result", "string", "text"),
	state("commands.lastError", "Last command error", "string", "text"),
	state("commands.lastExecution", "Last command execution", "string", "date"),
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

function consumableStates(prefix: string, name: string): StateDefinition[] {
	return [
		state(`${prefix}.usedSeconds`, `${name} used seconds`, "number", "value", { unit: "s", min: 0 }),
		state(`${prefix}.intervalHours`, `${name} interval`, "number", "value", { unit: "h", min: 0 }),
		state(`${prefix}.remainingPercent`, `${name} remaining`, "number", "value", { unit: "%" }),
		state(`${prefix}.overdueHours`, `${name} overdue`, "number", "value", { unit: "h", min: 0 }),
	];
}

function commandButton(definition: CommandDefinition): StateDefinition {
	return {
		id: definition.id,
		object: {
			_id: definition.id,
			type: "state",
			common: {
				name: definition.command,
				type: "boolean",
				role: "button",
				read: true,
				write: true,
				def: false,
			},
			native: {},
		},
	};
}

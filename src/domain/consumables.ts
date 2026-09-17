import type { CommandRequest } from "./commands";

export type ConsumableComponent = "filter" | "sideBrush" | "mainBrush" | "sensors";

export type ConsumableCounterField = ConsumableComponent | "battery";

export type ConsumableCounterSnapshot = Record<ConsumableCounterField, number>;

export interface ConsumableResetDefinition {
	id: string;
	component: ConsumableComponent;
	name: string;
}

export type ConsumableResetResult =
	"reading-before-reset" | "sending" | "echo-confirmed" | "verifying-readback" | "verified" | "already-zero";

export interface SafeConsumableResetOperations {
	readSnapshot: () => Promise<ConsumableCounterSnapshot>;
	sendReset: (before: ConsumableCounterSnapshot) => Promise<ConsumableCounterSnapshot>;
	onProgress: (result: ConsumableResetResult) => Promise<void>;
}

export const CONSUMABLE_RESET_DEFINITIONS: readonly ConsumableResetDefinition[] = [
	{ id: "consumables.filter.reset", component: "filter", name: "Reset filter runtime" },
	{ id: "consumables.sideBrush.reset", component: "sideBrush", name: "Reset side brush runtime" },
	{ id: "consumables.mainBrush.reset", component: "mainBrush", name: "Reset main brush runtime" },
	{ id: "consumables.sensors.reset", component: "sensors", name: "Reset sensor runtime" },
];

export interface ConsumableState {
	usedSeconds: number;
	intervalHours: number;
	remainingPercent: number;
	overdueHours: number;
}

export type ConsumableStates = Partial<Record<ConsumableComponent, ConsumableState>>;

const CONSUMABLE_INTERVAL_HOURS: Record<ConsumableComponent, number> = {
	filter: 150,
	sideBrush: 200,
	mainBrush: 300,
	sensors: 30,
};

const CONSUMABLE_COUNTER_FIELDS: readonly ConsumableCounterField[] = [
	"filter",
	"mainBrush",
	"sideBrush",
	"sensors",
	"battery",
];

export function consumableResetForStateId(id: string): ConsumableComponent | undefined {
	return CONSUMABLE_RESET_DEFINITIONS.find(definition => definition.id === id)?.component;
}

export function normalizeConsumableCounterSnapshot(data: unknown): ConsumableCounterSnapshot | undefined {
	if (data === null || typeof data !== "object" || Array.isArray(data)) {
		return undefined;
	}

	const record = data as Record<string, unknown>;
	const keys = Object.keys(record);
	if (
		keys.length !== CONSUMABLE_COUNTER_FIELDS.length ||
		keys.some(key => !CONSUMABLE_COUNTER_FIELDS.includes(key as ConsumableCounterField))
	) {
		return undefined;
	}

	const entries = CONSUMABLE_COUNTER_FIELDS.map(field => [field, record[field]] as const);
	if (entries.some(([, value]) => typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
		return undefined;
	}

	return Object.fromEntries(entries) as ConsumableCounterSnapshot;
}

export function buildConsumableResetRequest(
	component: ConsumableComponent,
	snapshot: ConsumableCounterSnapshot,
	serial: string,
	username: string,
): CommandRequest {
	return {
		path: `/instructions/cmd21016/${encodeURIComponent(serial)}?username=${encodeURIComponent(username)}`,
		contentType: "application/json;charset=UTF-8",
		body: JSON.stringify({ ...snapshot, [component]: 0 }),
	};
}

export function isConsumableResetConfirmation(
	before: ConsumableCounterSnapshot,
	after: ConsumableCounterSnapshot,
	component: ConsumableComponent,
): boolean {
	return CONSUMABLE_COUNTER_FIELDS.every(field => after[field] === (field === component ? 0 : before[field]));
}

export function consumableCounterSnapshotsEqual(
	expected: ConsumableCounterSnapshot,
	actual: ConsumableCounterSnapshot,
): boolean {
	return CONSUMABLE_COUNTER_FIELDS.every(field => actual[field] === expected[field]);
}

export async function runSafeConsumableReset(
	component: ConsumableComponent,
	operations: SafeConsumableResetOperations,
): Promise<"verified" | "already-zero"> {
	await operations.onProgress("reading-before-reset");
	const before = await operations.readSnapshot();
	if (before[component] === 0) {
		await operations.onProgress("already-zero");
		return "already-zero";
	}

	await operations.onProgress("sending");
	const echoed = await operations.sendReset(before);
	if (!isConsumableResetConfirmation(before, echoed, component)) {
		throw new Error("Consumable reset echo changed unexpected counters or did not reset the target");
	}

	await operations.onProgress("echo-confirmed");
	await operations.onProgress("verifying-readback");
	const persisted = await operations.readSnapshot();
	const expected = { ...before, [component]: 0 };
	if (!consumableCounterSnapshotsEqual(expected, persisted)) {
		throw new Error("Consumable reset did not persist exactly across the verification read");
	}

	await operations.onProgress("verified");
	return "verified";
}

export function normalizeConsumables21015(data: unknown): ConsumableStates | undefined {
	if (data === null || typeof data !== "object" || Array.isArray(data)) {
		return undefined;
	}

	const record = data as Record<string, unknown>;
	const consumables = Object.fromEntries(
		(Object.keys(CONSUMABLE_INTERVAL_HOURS) as ConsumableComponent[])
			.map(component => [component, normalizeConsumable(component, record[component])] as const)
			.filter((entry): entry is readonly [ConsumableComponent, ConsumableState] => entry[1] !== undefined),
	) as ConsumableStates;

	return Object.keys(consumables).length > 0 ? consumables : undefined;
}

function normalizeConsumable(component: ConsumableComponent, value: unknown): ConsumableState | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return undefined;
	}

	const usedSeconds = Math.trunc(value);
	const intervalHours = CONSUMABLE_INTERVAL_HOURS[component];
	const intervalSeconds = intervalHours * 3_600;
	const remainingPercent = roundToTwoDecimals((1 - usedSeconds / intervalSeconds) * 100);
	const overdueHours = roundToTwoDecimals(Math.max(0, (usedSeconds - intervalSeconds) / 3_600));

	return {
		usedSeconds,
		intervalHours,
		remainingPercent,
		overdueHours,
	};
}

function roundToTwoDecimals(value: number): number {
	return Math.round(value * 100) / 100;
}

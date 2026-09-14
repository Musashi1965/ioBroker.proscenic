export type ConsumableComponent = "filter" | "sideBrush" | "mainBrush" | "sensors";

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

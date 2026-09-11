export interface RobotStatus {
	mode?: string;
	subMode?: string;
	cleanArea?: number;
	cleanTime?: number;
	totalArea?: number;
	totalTime?: number;
	batteryPercent?: number;
	batteryRawPercent?: number;
	waterLevel?: number;
	mopMode?: number;
	fanMode?: string;
	errorRawCount?: number;
	maintenanceWarning?: boolean;
	maintenanceWarningCount?: number;
	maintenanceMessage?: string;
	autoBoost?: boolean;
	cleanComponents?: boolean;
}

export function normalizeStatus20001(data: unknown): RobotStatus | undefined {
	if (data === null || typeof data !== "object" || Array.isArray(data)) {
		return undefined;
	}

	const record = data as Record<string, unknown>;
	const status: RobotStatus = {};

	copyString(record, status, "mode", "mode");
	copyString(record, status, "subMode", "subMode");
	copyNumber(record, status, "cleanArea", "cleanArea");
	copyNumber(record, status, "cleanTime", "cleanTime");
	copyNumber(record, status, "allArea", "totalArea");
	copyNumber(record, status, "allTime", "totalTime");
	copyNumber(record, status, "elec", "batteryPercent");
	copyNumber(record, status, "elecReal", "batteryRawPercent");
	copyNumber(record, status, "water", "waterLevel");
	copyNumber(record, status, "mop", "mopMode");
	copyString(record, status, "workNoisy", "fanMode");
	copyBoolean(record, status, "autoBoost", "autoBoost");
	copyBoolean(record, status, "cleanComponents", "cleanComponents");

	if (Array.isArray(record.errorState)) {
		status.errorRawCount = record.errorState.length;
		status.maintenanceWarningCount = record.errorState.length;
		status.maintenanceWarning = record.errorState.length > 0;
		status.maintenanceMessage = record.errorState.length > 0 ? "Maintenance warning reported by robot" : "";
	}

	return Object.keys(status).length > 0 ? status : undefined;
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

function copyString<T extends object>(
	source: Record<string, unknown>,
	target: T,
	sourceKey: string,
	targetKey: keyof T & string,
): void {
	if (typeof source[sourceKey] === "string") {
		Object.assign(target, { [targetKey]: source[sourceKey] });
	}
}

function copyBoolean<T extends object>(
	source: Record<string, unknown>,
	target: T,
	sourceKey: string,
	targetKey: keyof T & string,
): void {
	if (typeof source[sourceKey] === "boolean") {
		Object.assign(target, { [targetKey]: source[sourceKey] });
	}
}

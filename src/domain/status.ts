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
	maintenanceDetails?: string;
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
		status.maintenanceDetails = summarizeErrorState(record.errorState);
	}

	return Object.keys(status).length > 0 ? status : undefined;
}

function summarizeErrorState(errorState: unknown[]): string {
	if (errorState.length === 0) {
		return "";
	}

	return JSON.stringify(
		errorState.slice(0, 5).map((entry, index) => ({
			index,
			...summarizeErrorEntry(entry),
		})),
	);
}

function summarizeErrorEntry(entry: unknown): Record<string, unknown> {
	if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
		return {
			type: typeof entry,
		};
	}

	const record = entry as Record<string, unknown>;
	const keys = Object.keys(record)
		.filter(key => !isSensitiveDiagnosticKey(key))
		.sort();
	const values: Record<string, string | number | boolean | null> = {};

	for (const key of keys) {
		const value = record[key];
		if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
			values[key] = typeof value === "string" ? redactDiagnosticString(value) : value;
		}
	}

	return {
		keys,
		values,
	};
}

function isSensitiveDiagnosticKey(key: string): boolean {
	return /(?:sn|serial|token|password|pwd|username|email|map|pos|position|path|addr|ip|host)/iu.test(key);
}

function redactDiagnosticString(value: string): string {
	return value
		.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu, "<redacted-email>")
		.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/gu, "<redacted-address>");
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

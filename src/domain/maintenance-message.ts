export interface MaintenanceMessage {
	code?: number;
	level?: number;
	title?: string;
	message?: string;
	details: string;
}

const MAX_TEXT_LENGTH = 200;

export function normalizeMaintenanceMessage20003(data: unknown): MaintenanceMessage | undefined {
	if (data === null || typeof data !== "object" || Array.isArray(data)) {
		return undefined;
	}

	const record = data as Record<string, unknown>;
	const nestedMessage = dataRecord(record.msg);
	const code = numberValue(record.code) ?? numberValue(nestedMessage?.code);
	const level = numberValue(record.level);
	const title = textValue(record.title);
	const message = textValue(nestedMessage?.message) ?? textValue(record.msg) ?? textValue(record.message);
	const details = JSON.stringify({
		infoType: 20003,
		...(code !== undefined ? { code } : {}),
		...(level !== undefined ? { level } : {}),
		...(title !== undefined ? { title } : {}),
		...(message !== undefined ? { message } : {}),
	});

	if (code === undefined && level === undefined && title === undefined && message === undefined) {
		return undefined;
	}

	return {
		...(code !== undefined ? { code } : {}),
		...(level !== undefined ? { level } : {}),
		...(title !== undefined ? { title } : {}),
		...(message !== undefined ? { message } : {}),
		details,
	};
}

function dataRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function textValue(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	return redactText(trimmed).slice(0, MAX_TEXT_LENGTH);
}

function redactText(value: string): string {
	return value
		.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu, "<redacted-email>")
		.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/gu, "<redacted-address>");
}

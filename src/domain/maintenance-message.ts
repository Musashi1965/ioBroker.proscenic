export interface MaintenanceMessage {
	code?: number;
	level?: number;
	title?: string;
	message?: string;
	eventTime?: string;
	details: string;
}

export interface MaintenanceHistory {
	messages: MaintenanceMessage[];
	totalElements?: number;
	totalPages?: number;
	page?: number;
	size?: number;
}

const MAX_TEXT_LENGTH = 200;
const MAX_HISTORY_ITEMS = 10;

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
	const eventTime =
		dateValue(record.timestamp) ?? dateValue(record.createdDate) ?? dateValue(record.lastModifiedDate);
	const details = JSON.stringify({
		infoType: 20003,
		...(code !== undefined ? { code } : {}),
		...(level !== undefined ? { level } : {}),
		...(title !== undefined ? { title } : {}),
		...(message !== undefined ? { message } : {}),
		...(eventTime !== undefined ? { eventTime } : {}),
	});

	if (
		code === undefined &&
		level === undefined &&
		title === undefined &&
		message === undefined &&
		eventTime === undefined
	) {
		return undefined;
	}

	return {
		...(code !== undefined ? { code } : {}),
		...(level !== undefined ? { level } : {}),
		...(title !== undefined ? { title } : {}),
		...(message !== undefined ? { message } : {}),
		...(eventTime !== undefined ? { eventTime } : {}),
		details,
	};
}

export function normalizeMaintenanceHistory20003(data: unknown): MaintenanceHistory | undefined {
	const record = dataRecord(data);
	const content = Array.isArray(record?.content) ? record.content : undefined;
	if (!content) {
		return undefined;
	}

	const messages = content
		.slice(0, MAX_HISTORY_ITEMS)
		.map(entry => normalizeMaintenanceMessage20003(entry))
		.filter((message): message is MaintenanceMessage => message !== undefined);

	if (messages.length === 0) {
		return undefined;
	}

	return {
		messages,
		...optionalNumber(record?.totalElements, "totalElements"),
		...optionalNumber(record?.totalPages, "totalPages"),
		...optionalNumber(record?.number, "page"),
		...optionalNumber(record?.size, "size"),
	};
}

function dataRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function numberValue(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
		const parsed = Number.parseInt(value.trim(), 10);
		return Number.isSafeInteger(parsed) ? parsed : undefined;
	}
	return undefined;
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

function dateValue(value: unknown): string | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		const millis = value > 10_000_000_000 ? value : value * 1_000;
		const date = new Date(millis);
		return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			return undefined;
		}
		const date = new Date(trimmed);
		return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
	}
	return undefined;
}

function optionalNumber<T extends string>(value: unknown, key: T): Partial<Record<T, number>> {
	const number = numberValue(value);
	return number === undefined ? {} : ({ [key]: number } as Partial<Record<T, number>>);
}

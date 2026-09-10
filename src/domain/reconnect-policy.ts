export interface ReconnectDelayOptions {
	initialDelayMs: number;
	maxDelayMs: number;
	factor: number;
}

export const DEFAULT_RECONNECT_DELAY_OPTIONS: ReconnectDelayOptions = {
	initialDelayMs: 5_000,
	maxDelayMs: 60_000,
	factor: 2,
};

export function reconnectDelayMs(
	attempt: number,
	options: ReconnectDelayOptions = DEFAULT_RECONNECT_DELAY_OPTIONS,
): number {
	if (!Number.isSafeInteger(attempt) || attempt < 1) {
		throw new Error("Reconnect attempt must be a positive safe integer");
	}
	if (options.initialDelayMs < 1 || options.maxDelayMs < options.initialDelayMs || options.factor < 1) {
		throw new Error("Invalid reconnect delay options");
	}

	const exponentialDelay = options.initialDelayMs * Math.pow(options.factor, attempt - 1);
	return Math.min(exponentialDelay, options.maxDelayMs);
}

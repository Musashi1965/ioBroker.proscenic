export interface ContinueCaptureOptions {
  captureSeconds: number | undefined;
  completionReason: string;
  nowMs: number;
  deadlineMs: number;
  eventCount: number;
  maxEvents: number;
}

export function parseMaxEvents(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Expected non-negative integer, got ${value}`);
  }
  if (parsed === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return parsed;
}

export function shouldContinueCaptureAfterCycle(options: ContinueCaptureOptions): boolean {
  if (options.captureSeconds === undefined) {
    return false;
  }
  if (options.nowMs >= options.deadlineMs) {
    return false;
  }
  if (options.eventCount >= options.maxEvents) {
    return false;
  }
  if (options.completionReason === "max-events-reached") {
    return false;
  }

  return true;
}

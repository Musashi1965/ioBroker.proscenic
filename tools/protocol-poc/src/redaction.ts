const SENSITIVE_KEY_PATTERN =
  /(^|_)(password|pwd|token|secret|authorization|auth|sn|serial|ip|addr|host|map|path|cookie|session)($|_)/i;

export function mask(value: string): string {
  if (value.length <= 4) {
    return "<redacted>";
  }

  return `${value.slice(0, 2)}...${value.slice(-2)}`;
}

export function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "<redacted>";
  }

  if (typeof value === "string" && value.length > 80) {
    return `<string:${value.length}>`;
  }

  return value;
}

export function summarizeObjectShape(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [`array:${value.length}`];
  }

  if (value === null || typeof value !== "object") {
    return typeof value;
  }

  const summary: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      summary[key] = "<redacted>";
      continue;
    }

    if (Array.isArray(child)) {
      summary[key] = `array:${child.length}`;
      continue;
    }

    if (child !== null && typeof child === "object") {
      summary[key] = `object:${Object.keys(child).length}`;
      continue;
    }

    summary[key] = typeof redactValue(key, child);
  }

  return summary;
}

const SENSITIVE_KEY_PATTERN =
  /(^|_)(password|pwd|token|secret|authorization|auth|sn|serial|ip|addr|host|map|path|cookie|session|username|email|account|name)($|_)/i;

const INTERESTING_KEY_PATTERN =
  /filter|brush|broom|sensor|consum|maint|life|remain|hour|warn|fault|error|case|exception|message|msg|notice|notify|dust|bag|collect|station|status|state|time|date|created|寿命|事件|异常|消息|告警|集尘|滤网|边刷|主刷|传感器/iu;

export interface InterestingFinding {
  path: string;
  type: string;
  value?: unknown;
}

const UNINTERESTING_ERROR_PATHS = new Set(["timestamp", "status", "error", "message", "path"]);

export function summarizeObjectShape(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [];
    }
    if (depth >= 3) {
      return [`array:${value.length}`];
    }
    return {
      type: `array:${value.length}`,
      first: summarizeObjectShape(value[0], depth + 1),
    };
  }

  if (value === null || typeof value !== "object") {
    return typeof value;
  }

  const summary: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      summary[key] = "<redacted>";
      continue;
    }

    if (Array.isArray(child)) {
      summary[key] = child.length === 0 || depth >= 2
        ? `array:${child.length}`
        : { type: `array:${child.length}`, first: summarizeObjectShape(child[0], depth + 1) };
      continue;
    }

    if (child !== null && typeof child === "object") {
      summary[key] = depth >= 2
        ? `object:${Object.keys(child as Record<string, unknown>).length}`
        : summarizeObjectShape(child, depth + 1);
      continue;
    }

    summary[key] = summarizeScalar(key, child);
  }

  return summary;
}

export function collectInterestingFindings(value: unknown, prefix = "", findings: InterestingFinding[] = []): InterestingFinding[] {
  if (prefix === "" && isPlainHttpErrorResponse(value)) {
    return findings;
  }

  if (Array.isArray(value)) {
    value.slice(0, 5).forEach((entry, index) => collectInterestingFindings(entry, `${prefix}[${index}]`, findings));
    return findings;
  }

  if (value === null || typeof value !== "object") {
    return findings;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (INTERESTING_KEY_PATTERN.test(key)) {
      findings.push({
        path,
        type: Array.isArray(child) ? "array" : child === null ? "null" : typeof child,
        value: summarizeScalar(key, child),
      });
    }
    collectInterestingFindings(child, path, findings);
  }

  return findings;
}

export function redactErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu, "<redacted-email>")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/gu, "<redacted-address>")
    .replace(/\b[A-Z0-9]{8,}\b/gu, "<redacted-token>");
}

function summarizeScalar(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "<redacted>";
  }
  if (typeof value === "string") {
    if (value.length === 0) {
      return "";
    }
    return INTERESTING_KEY_PATTERN.test(key) && value.length <= 40 ? `<string:${value.length}>` : `<string:${value.length}>`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return `array:${value.length}`;
  }
  if (value !== null && typeof value === "object") {
    return `object:${Object.keys(value as Record<string, unknown>).length}`;
  }
  return value === null ? "null" : typeof value;
}

function isPlainHttpErrorResponse(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    typeof record.status === "number" &&
    record.status >= 400 &&
    keys.length > 0 &&
    keys.every((key) => UNINTERESTING_ERROR_PATHS.has(key))
  );
}

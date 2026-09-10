export type StatusConfidence = "observed" | "candidate" | "unknown";

export interface StatusCandidate {
  upstreamField: string;
  valueType: "boolean" | "number" | "string" | "array";
  candidateStateId: string;
  candidateRole: string;
  unit?: string;
  confidence: StatusConfidence;
  note: string;
}

export const STATUS_20001_CANDIDATES: readonly StatusCandidate[] = [
  {
    upstreamField: "cleanArea",
    valueType: "number",
    candidateStateId: "status.clean.area",
    candidateRole: "value",
    unit: "m2",
    confidence: "candidate",
    note: "Observed as numeric cleaning area; unit still needs value-level confirmation.",
  },
  {
    upstreamField: "cleanTime",
    valueType: "number",
    candidateStateId: "status.clean.time",
    candidateRole: "value",
    unit: "min",
    confidence: "candidate",
    note: "Observed as numeric cleaning time; unit still needs value-level confirmation.",
  },
  {
    upstreamField: "allArea",
    valueType: "number",
    candidateStateId: "status.clean.totalArea",
    candidateRole: "value",
    unit: "m2",
    confidence: "candidate",
    note: "Likely lifetime or accumulated area; exact meaning pending.",
  },
  {
    upstreamField: "allTime",
    valueType: "number",
    candidateStateId: "status.clean.totalTime",
    candidateRole: "value",
    unit: "min",
    confidence: "candidate",
    note: "Likely lifetime or accumulated time; exact meaning pending.",
  },
  {
    upstreamField: "elec",
    valueType: "number",
    candidateStateId: "status.battery.percent",
    candidateRole: "value.battery",
    unit: "%",
    confidence: "candidate",
    note: "Likely battery percentage; compare with app before accepting.",
  },
  {
    upstreamField: "elecReal",
    valueType: "number",
    candidateStateId: "status.battery.rawPercent",
    candidateRole: "value.battery",
    unit: "%",
    confidence: "candidate",
    note: "Second battery-like value; decide whether public exposure is useful.",
  },
  {
    upstreamField: "mode",
    valueType: "string",
    candidateStateId: "status.mode",
    candidateRole: "state",
    confidence: "observed",
    note: "Observed as status mode string; enum values pending.",
  },
  {
    upstreamField: "subMode",
    valueType: "string",
    candidateStateId: "status.subMode",
    candidateRole: "state",
    confidence: "observed",
    note: "Observed as status sub-mode string; enum values pending.",
  },
  {
    upstreamField: "water",
    valueType: "number",
    candidateStateId: "status.water.level",
    candidateRole: "level",
    confidence: "candidate",
    note: "Likely mopping water level; range and enum mapping pending.",
  },
  {
    upstreamField: "mop",
    valueType: "number",
    candidateStateId: "status.mop.mode",
    candidateRole: "state",
    confidence: "candidate",
    note: "Likely mopping-related mode; semantics pending.",
  },
  {
    upstreamField: "workNoisy",
    valueType: "string",
    candidateStateId: "status.fan.mode",
    candidateRole: "state",
    confidence: "candidate",
    note: "Likely suction/fan mode string; enum values pending.",
  },
  {
    upstreamField: "errorState",
    valueType: "array",
    candidateStateId: "status.error.rawCount",
    candidateRole: "value",
    confidence: "candidate",
    note: "Observed as array shape only; raw error list must not become public contract.",
  },
  {
    upstreamField: "autoBoost",
    valueType: "boolean",
    candidateStateId: "status.features.autoBoost",
    candidateRole: "indicator",
    confidence: "observed",
    note: "Observed as boolean; user-visible meaning still pending.",
  },
  {
    upstreamField: "cleanComponents",
    valueType: "boolean",
    candidateStateId: "status.features.cleanComponents",
    candidateRole: "indicator",
    confidence: "observed",
    note: "Observed as boolean; user-visible meaning still pending.",
  },
];

export interface StatusCandidateSummary {
  infoType: 20001;
  observedCandidateFields: StatusCandidate[];
  unknownFields: string[];
}

export function summarizeStatus20001(data: unknown): StatusCandidateSummary | undefined {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  const observedCandidateFields = STATUS_20001_CANDIDATES.filter((candidate) =>
    hasExpectedType(record[candidate.upstreamField], candidate.valueType),
  );
  const knownFields = new Set(STATUS_20001_CANDIDATES.map((candidate) => candidate.upstreamField));
  const unknownFields = Object.keys(record).filter((field) => !knownFields.has(field)).sort();

  return {
    infoType: 20001,
    observedCandidateFields,
    unknownFields,
  };
}

function hasExpectedType(value: unknown, expected: StatusCandidate["valueType"]): boolean {
  if (expected === "array") {
    return Array.isArray(value);
  }

  return typeof value === expected;
}

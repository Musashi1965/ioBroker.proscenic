import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractSafeStatus20001Values, summarizeStatus20001 } from "./status-candidates.js";

describe("status candidate summary", () => {
  it("lists observed candidate fields without retaining values", () => {
    const summary = summarizeStatus20001({
      cleanArea: 23,
      cleanTime: 42,
      elec: 87,
      mode: "charge",
      subMode: "idle",
      errorState: [],
      unknownVendorField: "private-ish value",
    });

    assert.equal(summary?.infoType, 20001);
    assert.deepEqual(
      summary?.observedCandidateFields.map((candidate) => candidate.upstreamField),
      ["cleanArea", "cleanTime", "elec", "mode", "subMode", "errorState"],
    );
    assert.deepEqual(summary?.unknownFields, ["unknownVendorField"]);
    assert.equal(JSON.stringify(summary).includes("private-ish value"), false);
  });

  it("ignores fields with unexpected types", () => {
    const summary = summarizeStatus20001({
      cleanArea: "23",
      mode: "charge",
    });

    assert.deepEqual(
      summary?.observedCandidateFields.map((candidate) => candidate.upstreamField),
      ["mode"],
    );
  });

  it("extracts explicitly allowed live values without map or position data", () => {
    const values = extractSafeStatus20001Values({
      SN: "private-serial",
      cleanArea: 23,
      cleanTime: 42,
      elec: 87,
      elecReal: 86,
      errorState: ["some-error"],
      map: "private-map",
      mode: "charge",
      phi: 123,
      pos: [1, 2],
      subMode: "idle",
      timeStamp: 123456789,
      workNoisy: "normal",
    });

    assert.deepEqual(values, {
      cleanArea: 23,
      cleanTime: 42,
      elec: 87,
      elecReal: 86,
      errorCount: 1,
      mode: "charge",
      subMode: "idle",
      workNoisy: "normal",
    });
  });
});

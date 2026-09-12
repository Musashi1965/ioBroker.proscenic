import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeCaptureLines } from "./capture-analysis.js";

describe("capture analysis", () => {
  it("summarizes private captures without raw private values", () => {
    const analysis = analyzeCaptureLines([
      JSON.stringify({
        kind: "event",
        index: 1,
        infoType: 20001,
        decrypted: {
          infoType: 20001,
          data: {
            cleanArea: 12,
            cleanTime: 34,
            elec: 88,
            errorState: [{ code: 7, message: "fixture warning" }],
            mode: "sweep",
            pos: [1, 2],
            SN: "fixture-serial",
            token: "fixture-token",
            workNoisy: "strong",
          },
        },
      }),
      JSON.stringify({
        kind: "event",
        index: 2,
        infoType: 20002,
        decrypted: {
          infoType: 20002,
          data: {
            area: [{ id: 1 }],
            base64_len: 19,
            chargeHandlePos: [3, 4],
            height: 187,
            lz4_len: 4578,
            map: "fixture-map-payload",
            mapId: 1756629262,
            pathId: 1789117423,
            pos: [5, 6],
            resolution: 0.05,
            SN: "fixture-serial",
            width: 205,
          },
        },
      }),
      JSON.stringify({
        kind: "frame-error",
        index: 1,
        message: "decrypt failed",
      }),
      JSON.stringify({
        kind: "run",
        gatewayCompletion: {
          reason: "listen-window-elapsed",
          cycles: 4,
          elapsedMs: 68252,
        },
      }),
      "{malformed",
    ], "capture.jsonl");

    assert.equal(analysis.records.total, 5);
    assert.equal(analysis.records.malformed, 1);
    assert.equal(analysis.records.events, 2);
    assert.equal(analysis.records.frameErrors, 1);
    assert.equal(analysis.status20001.safeEnums.mode[0], "sweep");
    assert.equal(analysis.status20001.numberRanges.cleanArea.min, 12);
    assert.equal(analysis.status20001.errorStateLengths["1"], 1);
    assert.equal(analysis.map20002.availableCount, 1);
    assert.equal(analysis.map20002.metadataRanges.base64_len.max, 19);
    assert.equal(analysis.map20002.metadataRanges.width.max, 205);
    assert.equal(analysis.gateway.frameErrorMessages["decrypt failed"], 1);

    const serialized = JSON.stringify(analysis);
    assert.equal(serialized.includes("fixture-serial"), false);
    assert.equal(serialized.includes("fixture-token"), false);
    assert.equal(serialized.includes("fixture-map-payload"), false);
    assert.equal(serialized.includes("fixture warning"), false);
    assert.equal(serialized.includes("[1,2]"), false);
    assert.equal(serialized.includes("[3,4]"), false);
  });
});

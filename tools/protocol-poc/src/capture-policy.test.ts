import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMaxEvents, shouldContinueCaptureAfterCycle } from "./capture-policy.js";

describe("capture policy", () => {
  it("treats max events zero as unlimited", () => {
    assert.equal(parseMaxEvents("0", 3), Number.POSITIVE_INFINITY);
    assert.equal(parseMaxEvents(undefined, 3), 3);
    assert.equal(parseMaxEvents("45", 3), 45);
  });

  it("continues after a listen window when an overall capture window remains", () => {
    assert.equal(shouldContinueCaptureAfterCycle({
      captureSeconds: 900,
      completionReason: "listen-window-elapsed",
      nowMs: 120_000,
      deadlineMs: 900_000,
      eventCount: 45,
      maxEvents: Number.POSITIVE_INFINITY,
    }), true);
  });

  it("does not continue single-window captures", () => {
    assert.equal(shouldContinueCaptureAfterCycle({
      captureSeconds: undefined,
      completionReason: "listen-window-elapsed",
      nowMs: 90_000,
      deadlineMs: 90_000,
      eventCount: 45,
      maxEvents: Number.POSITIVE_INFINITY,
    }), false);
  });

  it("stops at the capture deadline or event limit", () => {
    assert.equal(shouldContinueCaptureAfterCycle({
      captureSeconds: 900,
      completionReason: "listen-window-elapsed",
      nowMs: 900_000,
      deadlineMs: 900_000,
      eventCount: 45,
      maxEvents: Number.POSITIVE_INFINITY,
    }), false);

    assert.equal(shouldContinueCaptureAfterCycle({
      captureSeconds: 900,
      completionReason: "max-events-reached",
      nowMs: 120_000,
      deadlineMs: 900_000,
      eventCount: 45,
      maxEvents: 45,
    }), false);
  });
});

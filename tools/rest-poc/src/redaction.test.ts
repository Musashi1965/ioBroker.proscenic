import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectInterestingFindings, redactErrorMessage, summarizeObjectShape } from "./redaction.js";

describe("REST redaction", () => {
  it("summarizes responses without exposing private values", () => {
    const response = {
      code: 0,
      data: {
        username: "user@example.invalid",
        sn: "private-serial",
        filter: 24,
        sensorLife: -319,
        messages: [
          {
            createdAt: "2026-09-14 10:49:23",
            message: "private warning text",
          },
        ],
      },
    };

    const shape = summarizeObjectShape(response);
    const findings = collectInterestingFindings(response);
    const serialized = JSON.stringify({ shape, findings });

    assert.equal(serialized.includes("user@example.invalid"), false);
    assert.equal(serialized.includes("private-serial"), false);
    assert.equal(serialized.includes("private warning text"), false);
    assert.equal(findings.some((finding) => finding.path === "data.filter"), true);
    assert.equal(findings.some((finding) => finding.path === "data.sensorLife"), true);
    assert.equal(findings.some((finding) => finding.path === "data.messages"), true);
  });

  it("redacts sensitive error message material", () => {
    assert.equal(
      redactErrorMessage(new Error("failed user@example.invalid at 192.0.2.10 with ABCDEF1234567890")),
      "failed <redacted-email> at <redacted-address> with <redacted-token>",
    );
  });

  it("does not treat plain HTTP error envelopes as endpoint findings", () => {
    assert.deepEqual(
      collectInterestingFindings({
        timestamp: "2026-09-14T10:00:00.000+00:00",
        status: 404,
        error: "Not Found",
        message: "",
        path: "/private/path",
      }),
      [],
    );
  });
});

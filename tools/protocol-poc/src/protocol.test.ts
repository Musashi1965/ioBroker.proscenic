import { createCipheriv } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decryptGatewayPayload,
  FRAME_DELIMITER,
  gatewayHandshake,
  md5Hex,
  splitFrames,
} from "./protocol.js";
import { summarizeObjectShape } from "./redaction.js";

describe("protocol helpers", () => {
  it("creates the legacy password hash", () => {
    assert.equal(md5Hex("secret"), "5ebe2294ecd0e0f08eab7690d2a6ee69");
  });

  it("frames the gateway handshake", () => {
    const frame = gatewayHandshake("0123456789abcdef", "serial");
    assert.ok(frame.endsWith(FRAME_DELIMITER));
    assert.deepEqual(JSON.parse(frame.slice(0, -FRAME_DELIMITER.length)), {
      data: {
        token: "0123456789abcdef",
        sn: "serial",
      },
      infoType: 70001,
    });
  });

  it("splits complete frames and returns the unfinished tail", () => {
    assert.deepEqual(splitFrames(`a${FRAME_DELIMITER}b${FRAME_DELIMITER}tail`), {
      frames: ["a", "b"],
      rest: "tail",
    });
  });

  it("decrypts AES-ECB gateway payloads", () => {
    const token = "0123456789abcdef";
    const plaintext = JSON.stringify({ infoType: 20001, data: { cleanState: 1 } });
    const cipher = createCipheriv("aes-128-ecb", Buffer.from(token), null);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");

    assert.equal(decryptGatewayPayload(encrypted, token), plaintext);
  });

  it("summarizes sensitive and bulky data without values", () => {
    assert.deepEqual(summarizeObjectShape({
      SN: "private-serial",
      cleanState: 1,
      map: "x".repeat(120),
      nested: { value: true },
      area: [1, 2, 3],
    }), {
      SN: "<redacted>",
      cleanState: "number",
      map: "<redacted>",
      nested: "object:1",
      area: "array:3",
    });
  });
});

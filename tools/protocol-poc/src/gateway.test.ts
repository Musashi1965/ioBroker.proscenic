import { createCipheriv } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGatewayFrame } from "./gateway.js";

describe("gateway frame parser", () => {
  it("decrypts encrypted gateway frames when a token is available", () => {
    const token = "0123456789abcdef";
    const plaintext = JSON.stringify({
      infoType: 20001,
      data: {
        cleanState: 1,
      },
    });
    const cipher = createCipheriv("aes-128-ecb", Buffer.from(token), null);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]).toString("base64");

    assert.deepEqual(parseGatewayFrame(JSON.stringify({
      encrypt: true,
      data: encrypted,
    }), token), {
      encrypted: true,
      infoType: 20001,
      decrypted: {
        infoType: 20001,
        data: {
          cleanState: 1,
        },
      },
    });
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeMapPayload, decompressLz4Block } from "./map-payload.js";

describe("map payload helpers", () => {
  it("restores plus characters that arrived as whitespace before base64 decoding", () => {
    const original = Buffer.from([0xfb, 0xef, 0xbe, 0x01]);
    const encoded = original.toString("base64").replace(/\+/gu, " ");

    const decoded = decodeMapPayload(encoded);

    assert.equal(decoded.restoredBase64Chars, (encoded.match(/\s/gu) ?? []).length);
    assert.deepEqual(decoded.compressed, original);
  });

  it("decompresses an lz4 literal-only block", () => {
    const block = Buffer.from([
      0xf0,
      0x01,
      0x00,
      0x7f,
      0xff,
      0x00,
      0x7f,
      0xff,
      0x00,
      0x7f,
      0xff,
      0x00,
      0x7f,
      0xff,
      0x00,
      0x7f,
      0xff,
      0x00,
    ]);

    const decompressed = decompressLz4Block(block, 16);

    assert.equal(decompressed.length, 16);
    assert.deepEqual([...new Set(decompressed)].sort((left, right) => left - right), [0, 127, 255]);
  });
});

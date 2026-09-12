import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { encodeGrayscalePng, renderMapFromPrivateCapture } from "./map-renderer.js";

describe("map renderer", () => {
  it("encodes a grayscale PNG without external dependencies", () => {
    const png = encodeGrayscalePng(2, 2, Buffer.from([0, 127, 200, 255]));

    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
    assert.ok(png.length > 40);
  });

  it("renders private capture probes without printing raw map payloads", async () => {
    const temp = await mkdtemp(join(tmpdir(), "proscenic-map-renderer-"));
    try {
      const capturePath = join(temp, "capture.jsonl");
      const outputDirectory = join(temp, "out");
      const encoded = Buffer.from([0xff, 0x00, 0xaa, 0x55, 0xf0, 0x0f, 0x33, 0xcc]).toString("base64");
      await writeFile(capturePath, `${JSON.stringify({
        kind: "event",
        index: 7,
        infoType: 20002,
        decrypted: {
          infoType: 20002,
          data: {
            SN: "fixture-private-serial",
            map: encoded,
            width: 4,
            height: 4,
            resolution: 0.05,
          },
        },
      })}\n`);

      const result = await renderMapFromPrivateCapture({ capturePath, outputDirectory });
      assert.equal(result.eventIndex, 7);
      assert.equal(result.files.length, 31);
      assert.equal(result.probes.bitOffsetCount, 12);
      assert.equal(result.probes.coordinateOffsetCount, 8);
      assert.equal(result.probes.filteredCoordinateOffsetCount, 8);
      assert.equal(result.probes.contactSheets.length, 3);
      assert.equal(result.privacy.outputContainsRawPayloads, false);

      const firstFile = await readFile(result.files[0]);
      assert.equal(firstFile.subarray(1, 4).toString("ascii"), "PNG");

      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes(encoded), false);
      assert.equal(serialized.includes("fixture-private-serial"), false);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { analyzeMapFormat } from "./map-format-analysis.js";

describe("map format analysis", () => {
  it("summarizes private map structure without raw payloads or coordinates", async () => {
    const temp = await mkdtemp(join(tmpdir(), "proscenic-map-format-"));
    try {
      const capturePath = join(temp, "capture.jsonl");
      const firstMap = Buffer.from([0, 1, 2, 3, 0, 0xff, 4, 5, 6, 7, 8, 9]).toString("base64");
      const secondMap = Buffer.from([0, 1, 2, 4, 0, 0xff, 4, 5, 6, 8, 8, 9, 10]).toString("base64");

      await writeFile(capturePath, `${JSON.stringify({
        kind: "event",
        index: 1,
        infoType: 20002,
        decrypted: {
          data: {
            map: firstMap,
            width: 8,
            height: 8,
            resolution: 0.05,
            x_min: -0.1,
            y_min: -0.1,
            pathId: 1,
            area: [{
              vertexs: [
                [-50, -50],
                [0, -50],
                [0, 0],
                [-50, 0],
              ],
            }],
            chargeHandlePos: [50, 50],
            SN: "fixture-private-serial",
          },
        },
      })}\n${JSON.stringify({
        kind: "event",
        index: 2,
        infoType: 20002,
        decrypted: {
          data: {
            map: secondMap,
            width: 8,
            height: 8,
            resolution: 0.05,
            x_min: -0.1,
            y_min: -0.1,
            pathId: 2,
            area: [{
              vertexs: [
                [-50, -50],
                [0, -50],
                [0, 0],
                [-50, 0],
              ],
            }],
            chargeHandlePos: [50, 50],
            SN: "fixture-private-serial",
          },
        },
      })}\n`);

      const analysis = await analyzeMapFormat({ capturePath });

      assert.equal(analysis.samples.total, 2);
      assert.equal(analysis.samples.selectedEvent, 2);
      assert.equal(analysis.samples.pathSegments.length, 2);
      assert.equal(analysis.geometry.coordinateProjectionAvailable, true);
      assert.equal(analysis.geometry.areaVertexProjection?.projectedPoints, 4);
      assert.equal(analysis.geometry.areaVertexProjection?.inBounds, 4);
      assert.equal(analysis.geometry.chargeProjection?.inBounds, 1);
      assert.equal(analysis.payload.directBitmapFeasibility[0].bitsPerCell, 1);
      assert.equal(analysis.payload.adjacentChanges.comparisons, 1);
      assert.equal(analysis.payload.adjacentChanges.changedPayload, 1);
      assert.ok(analysis.rasterHypotheses.length > 0);
      assert.equal(analysis.privacy.outputContainsRawPayloads, false);

      const serialized = JSON.stringify(analysis);
      assert.equal(serialized.includes(firstMap), false);
      assert.equal(serialized.includes(secondMap), false);
      assert.equal(serialized.includes("fixture-private-serial"), false);
      assert.equal(serialized.includes("[-50,-50]"), false);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});

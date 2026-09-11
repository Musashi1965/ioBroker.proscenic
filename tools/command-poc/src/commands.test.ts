import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCommandRequest, isCommandName } from "./commands.js";

void describe("buildCommandRequest", () => {
  void it("builds the start command request", () => {
    assert.deepEqual(buildCommandRequest("start", "serial value", "user@example.invalid"), {
      path: "/instructions/cmd21005/serial%20value?username=user%40example.invalid",
      body: "cleanMode=sweepOnly",
    });
  });

  void it("builds pause and continue on the shared action endpoint", () => {
    assert.deepEqual(buildCommandRequest("pause", "serial", "user@example.invalid"), {
      path: "/instructions/serial/21017?username=user%40example.invalid",
      body: "mode=pause",
    });
    assert.deepEqual(buildCommandRequest("continue", "serial", "user@example.invalid"), {
      path: "/instructions/serial/21017?username=user%40example.invalid",
      body: "pauseOrContinue=continue",
    });
  });

  void it("builds the return command request", () => {
    assert.deepEqual(buildCommandRequest("return", "serial", "user@example.invalid"), {
      path: "/instructions/serial/21012?username=user%40example.invalid",
      body: "charge=start",
    });
  });

  void it("builds fan speed command requests", () => {
    assert.deepEqual(buildCommandRequest("fan-quiet", "serial", "user@example.invalid"), {
      path: "/instructions/serial/21022?username=user%40example.invalid",
      body: "setMode=quiet",
    });
    assert.deepEqual(buildCommandRequest("fan-standard", "serial", "user@example.invalid"), {
      path: "/instructions/serial/21022?username=user%40example.invalid",
      body: "setMode=auto",
    });
    assert.deepEqual(buildCommandRequest("fan-strong", "serial", "user@example.invalid"), {
      path: "/instructions/serial/21022?username=user%40example.invalid",
      body: "setMode=strong",
    });
  });

  void it("builds deep cleaning and collect dust command requests", () => {
    assert.deepEqual(buildCommandRequest("deep-cleaning", "serial", "user@example.invalid"), {
      path: "/instructions/cmd21005_2/serial?username=user%40example.invalid",
      body: "mode=depthTotalClean",
    });
    assert.deepEqual(
      buildCommandRequest("collect-dust", "serial", "user@example.invalid", new Date("2026-09-11T10:00:00.000Z")),
      {
        path: "/instructions/cmd/serial?username=user%40example.invalid",
        contentType: "application/json;charset=UTF-8",
        body: JSON.stringify({
          dInfo: {
            ts: "1789120800000",
            userId: "user@example.invalid",
          },
          data: {
            cmd: "startDustCenter",
            value: 0,
          },
          infoType: 21024,
        }),
      },
    );
  });
});

void describe("isCommandName", () => {
  void it("accepts only known command candidates", () => {
    assert.equal(isCommandName("start"), true);
    assert.equal(isCommandName("pause"), true);
    assert.equal(isCommandName("continue"), true);
    assert.equal(isCommandName("return"), true);
    assert.equal(isCommandName("fan-quiet"), true);
    assert.equal(isCommandName("fan-standard"), true);
    assert.equal(isCommandName("fan-strong"), true);
    assert.equal(isCommandName("deep-cleaning"), true);
    assert.equal(isCommandName("collect-dust"), true);
    assert.equal(isCommandName("dock"), false);
  });
});

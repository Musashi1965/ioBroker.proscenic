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
});

void describe("isCommandName", () => {
  void it("accepts only the first command candidates", () => {
    assert.equal(isCommandName("start"), true);
    assert.equal(isCommandName("pause"), true);
    assert.equal(isCommandName("continue"), true);
    assert.equal(isCommandName("return"), true);
    assert.equal(isCommandName("dock"), false);
  });
});

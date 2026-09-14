import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateAccountEmailForTest } from "./validation.js";

describe("REST CLI validation", () => {
  it("rejects placeholder account addresses", () => {
    assert.throws(() => validateAccountEmailForTest("<deine-proscenic-mail>"), /placeholder/u);
    assert.throws(() => validateAccountEmailForTest("user@example.invalid"), /placeholder/u);
  });

  it("rejects malformed account addresses", () => {
    assert.throws(() => validateAccountEmailForTest("not-an-email"), /real Proscenic account/u);
  });
});

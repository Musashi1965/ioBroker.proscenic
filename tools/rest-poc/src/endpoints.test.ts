import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterEndpointCandidates } from "./endpoints.js";

describe("REST endpoint candidates", () => {
  it("filters by endpoint group", () => {
    assert.ok(filterEndpointCandidates("all").length > filterEndpointCandidates("messages").length);
    assert.ok(filterEndpointCandidates("maintenance").every((candidate) => candidate.group === "maintenance"));
    assert.ok(filterEndpointCandidates("messages").every((candidate) => candidate.group === "messages"));
    assert.ok(filterEndpointCandidates("map").every((candidate) => candidate.group === "map"));
    assert.ok(filterEndpointCandidates("rooms").every((candidate) => candidate.group === "rooms"));
  });

  it("generates a broad reverse-engineering matrix", () => {
    assert.ok(filterEndpointCandidates("maintenance").length > 1_000);
    assert.ok(filterEndpointCandidates("messages").length > 1_000);
    assert.ok(filterEndpointCandidates("all").some((candidate) => candidate.method === "GET"));
    assert.ok(filterEndpointCandidates("all").some((candidate) => candidate.id.includes("page")));
  });

  it("rejects unsupported endpoint groups", () => {
    assert.throws(() => filterEndpointCandidates("commands"), /Unsupported endpoint group/u);
  });
});

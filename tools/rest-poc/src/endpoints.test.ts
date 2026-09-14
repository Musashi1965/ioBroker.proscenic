import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterEndpointCandidates } from "./endpoints.js";

describe("REST endpoint candidates", () => {
  it("restricts the observed scan to the verified read requests", () => {
    const requests = filterEndpointCandidates("observed");
    const context = { username: "owner@example.invalid", serial: "test/device" };
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map((entry) => ({
      path: entry.path(context), body: entry.body?.(context),
      method: entry.method, token: entry.token,
    })), [
      { path: "/instructions/cmd21015/test%2Fdevice", body: { username: context.username }, method: "POST", token: true },
      { path: "/app/cleanRobot/20003/test%2Fdevice", body: {
        username: context.username, language: "EN", model: "M7", page: "0", size: "10",
      }, method: "POST", token: true },
    ]);
    assert.ok(filterEndpointCandidates("all").every((entry) => !entry.path(context).includes("21016")));
  });
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

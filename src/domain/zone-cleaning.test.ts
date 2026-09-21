import { expect } from "chai";
import type { LiveMapCoordinateMetadata } from "./live-map";
import {
	buildZoneCleaningRequest,
	normalizeZoneSelection,
	shouldRecoverPendingZoneCleaningSelection,
	validateZoneCleaningSelection,
	zoneCleaningOptions,
} from "./zone-cleaning";

const catalog: LiveMapCoordinateMetadata = {
	mapId: 42,
	area: [
		{ key: "id:1001", kind: "zone", source: { id: 1001, name: "Zone A", vertexs: [] } },
		{ key: "id:1002", kind: "zone", source: { id: "1002", tag: "Zone B", vertexs: [] } },
		{ key: "id:1003", kind: "forbidden", source: { id: 1003, name: "No-go", vertexs: [] } },
	],
};

describe("zone cleaning", () => {
	it("normalizes JSON and comma-separated zone selections", () => {
		expect(normalizeZoneSelection("[1001,1002]")).to.deep.equal([1001, 1002]);
		expect(normalizeZoneSelection("1001, 1002")).to.deep.equal([1001, 1002]);
		expect(normalizeZoneSelection("")).to.deep.equal([]);
		expect(normalizeZoneSelection("[1001,1001]")).to.equal(undefined);
		expect(normalizeZoneSelection("[1001,-1]")).to.equal(undefined);
		expect(normalizeZoneSelection("not-json")).to.equal(undefined);
	});

	it("publishes and accepts only selectable zones from the matching map", () => {
		expect(zoneCleaningOptions(catalog)).to.deep.equal([
			{ id: 1001, label: "Zone A" },
			{ id: 1002, label: "Zone B" },
		]);
		expect(validateZoneCleaningSelection([1002], 42, catalog)).to.deep.equal({ mapId: 42, zoneIds: [1002] });
		expect(() => validateZoneCleaningSelection([1003], 42, catalog)).to.throw("no longer available");
		expect(() => validateZoneCleaningSelection([1001], 43, catalog)).to.throw("does not match");
		expect(() => validateZoneCleaningSelection([], 42, catalog)).to.throw("No map zones");
	});

	it("builds the verified partial-cleaning 30000 request", () => {
		expect(
			buildZoneCleaningRequest({ mapId: 42, zoneIds: [1001, 1002] }, "serial/value", "user@example.invalid"),
		).to.deep.equal({
			path: "/instructions/cmd30000/serial%2Fvalue/42?username=user%40example.invalid&part=true",
			contentType: "application/json;charset=UTF-8",
			body: "[1001,1002]",
		});
	});

	it("recovers only selections that belong to an accepted zone-cleaning command", () => {
		const execution = "2026-09-21T10:05:00.000Z";
		const selectionChangedAt = Date.parse("2026-09-21T10:04:00.000Z");

		expect(
			shouldRecoverPendingZoneCleaningSelection(
				2,
				selectionChangedAt,
				"zoneCleaning",
				"status-confirmed",
				execution,
			),
		).to.equal(true);
		expect(
			shouldRecoverPendingZoneCleaningSelection(
				1,
				Date.parse("2026-09-21T10:06:00.000Z"),
				"zoneCleaning",
				"status-confirmed",
				execution,
			),
		).to.equal(false);
		expect(
			shouldRecoverPendingZoneCleaningSelection(2, selectionChangedAt, "zoneCleaning", "failed", execution),
		).to.equal(false);
		expect(
			shouldRecoverPendingZoneCleaningSelection(
				0,
				selectionChangedAt,
				"zoneCleaning",
				"status-confirmed",
				execution,
			),
		).to.equal(false);
	});
});

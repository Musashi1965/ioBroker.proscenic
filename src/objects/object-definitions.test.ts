import { expect } from "chai";
import { STATE_DEFINITIONS } from "./object-definitions";

describe("initial object definitions", () => {
	it("keeps non-command states read-only", () => {
		for (const definition of STATE_DEFINITIONS) {
			if (!definition.id.startsWith("commands.") || definition.id.startsWith("commands.last")) {
				expect(definition.object.common.write, definition.id).to.equal(false);
				expect(definition.object.common.read, definition.id).to.equal(true);
			}
		}
	});

	it("exposes only confirmed command buttons", () => {
		const ids = STATE_DEFINITIONS.map(definition => definition.id);
		const writableIds = STATE_DEFINITIONS.filter(definition => definition.object.common.write).map(
			definition => definition.id,
		);

		expect(ids).to.include("device.image");
		expect(ids).to.include("status.maintenance.code");
		expect(ids).to.include("status.maintenance.level");
		expect(ids).to.include("status.maintenance.eventCount");
		expect(ids).to.include("status.maintenance.updated");
		expect(ids).to.include("capabilities.consumables");
		expect(ids).to.include("capabilities.maintenanceMessages");
		expect(ids).to.include("consumables.filter.usedSeconds");
		expect(ids).to.include("consumables.filter.remainingPercent");
		expect(ids).to.include("consumables.sideBrush.usedSeconds");
		expect(ids).to.include("consumables.mainBrush.usedSeconds");
		expect(ids).to.include("consumables.sensors.remainingPercent");
		expect(ids).to.include("consumables.updated");
		expect(ids).to.include("status.maintenance.history.items");
		expect(ids).to.include("status.maintenance.history.count");
		expect(ids).to.include("status.maintenance.history.totalCount");
		expect(ids).to.include("status.maintenance.history.latestCode");
		expect(ids).to.include("status.maintenance.history.latestLevel");
		expect(ids).to.include("status.maintenance.history.latestMessage");
		expect(ids).to.include("status.maintenance.history.latestEventTime");
		expect(ids).to.include("status.maintenance.history.updated");
		expect(ids).to.include("commands.start");
		expect(ids).to.include("commands.pause");
		expect(ids).to.include("commands.continue");
		expect(ids).to.include("commands.return");
		expect(ids).to.include("commands.fan.quiet");
		expect(ids).to.include("commands.fan.standard");
		expect(ids).to.include("commands.fan.strong");
		expect(ids).to.include("commands.deepCleaning");
		expect(ids).to.include("commands.collectDust");
		expect(writableIds).to.have.members([
			"commands.start",
			"commands.pause",
			"commands.continue",
			"commands.return",
			"commands.fan.quiet",
			"commands.fan.standard",
			"commands.fan.strong",
			"commands.deepCleaning",
			"commands.collectDust",
		]);
		for (const definition of STATE_DEFINITIONS) {
			if (writableIds.includes(definition.id)) {
				expect(definition.object.common.role, definition.id).to.equal("button");
				expect(definition.object.common.read, definition.id).to.equal(false);
				expect(definition.object.common.write, definition.id).to.equal(true);
			}
		}
	});

	it("keeps the observed water level read-only until write semantics are validated", () => {
		const waterLevel = STATE_DEFINITIONS.find(definition => definition.id === "status.water.level");

		expect(waterLevel).to.not.equal(undefined);
		expect(waterLevel?.object.common.role).to.equal("value");
		expect(waterLevel?.object.common.read).to.equal(true);
		expect(waterLevel?.object.common.write).to.equal(false);
	});

	it("exposes safe map metadata and an explicit experimental live image without raw maps, positions, serials, or gateway endpoints", () => {
		const ids = STATE_DEFINITIONS.map(definition => definition.id);

		expect(ids).to.include("map.available");
		expect(ids).to.include("map.id");
		expect(ids).to.include("map.pathId");
		expect(ids).to.include("map.width");
		expect(ids).to.include("map.height");
		expect(ids).to.include("map.resolution");
		expect(ids).to.include("map.areaCount");
		expect(ids).to.include("map.compressedBytes");
		expect(ids).to.include("map.encodedBytes");
		expect(ids).to.include("map.updated");
		expect(ids).to.include("map.live.image");
		expect(ids).to.include("map.live.areas");
		expect(ids).to.include("map.live.updated");
		expect(ids).to.include("map.live.orientation");
		expect(ids).to.include("map.live.poseCount");
		expect(ids).to.include("map.live.rawPoseCount");
		expect(ids).to.include("map.live.pathLineSegments");
		expect(ids).to.include("map.live.skippedPathSegments");
		expect(ids).to.include("map.live.currentAreaCount");
		expect(ids).to.include("map.live.cachedAreaCount");
		expect(ids).to.include("map.live.renderedForbiddenAreaCount");
		expect(ids).to.include("map.live.renderedRoomAreaCount");
		expect(ids).to.include("map.live.hasCachedStaticOverlays");
		expect(ids).to.include("map.live.renderReason");
		expect(ids).to.include("map.live.lastPathId");
		expect(ids).to.include("map.live.pathResetCount");
		expect(ids).to.include("map.live.lastPoseUpdated");
		expect(ids).to.include("map.live.decompressedBytes");
		expect(ids).to.not.include("map.raw");
		expect(ids).to.not.include("map.image");
		expect(ids).to.not.include("map.payload");
		expect(ids).to.not.include("status.position");
		expect(ids).to.not.include("device.serial");
		expect(ids).to.not.include("consumables.battery");
		expect(ids).to.not.include("status.maintenance.history.raw");
		expect(ids).to.not.include("connection.gatewayEndpoint");
	});
});

import { expect } from "chai";
import { STATE_DEFINITIONS } from "./object-definitions";

describe("initial object definitions", () => {
	it("keeps non-command states read-only", () => {
		for (const definition of STATE_DEFINITIONS) {
			if (!definition.id.startsWith("commands.") || definition.id.startsWith("commands.last")) {
				expect(definition.object.common.write, definition.id).to.equal(false);
			}
			expect(definition.object.common.read, definition.id).to.equal(true);
		}
	});

	it("exposes only confirmed command buttons", () => {
		const ids = STATE_DEFINITIONS.map(definition => definition.id);
		const writableIds = STATE_DEFINITIONS.filter(definition => definition.object.common.write).map(
			definition => definition.id,
		);

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
	});

	it("does not expose maps, positions, serials, or gateway endpoints", () => {
		const ids = STATE_DEFINITIONS.map(definition => definition.id);

		expect(ids).to.not.include("map.raw");
		expect(ids).to.not.include("status.position");
		expect(ids).to.not.include("device.serial");
		expect(ids).to.not.include("connection.gatewayEndpoint");
	});
});

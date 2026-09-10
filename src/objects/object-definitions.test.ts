import { expect } from "chai";
import { STATE_DEFINITIONS } from "./object-definitions";

describe("initial object definitions", () => {
	it("keeps all initial states read-only", () => {
		for (const definition of STATE_DEFINITIONS) {
			expect(definition.object.common.write, definition.id).to.equal(false);
			expect(definition.object.common.read, definition.id).to.equal(true);
		}
	});

	it("does not expose commands, maps, positions, serials, or gateway endpoints", () => {
		const ids = STATE_DEFINITIONS.map(definition => definition.id);

		expect(ids).to.not.include("commands.start");
		expect(ids).to.not.include("map.raw");
		expect(ids).to.not.include("status.position");
		expect(ids).to.not.include("device.serial");
		expect(ids).to.not.include("connection.gatewayEndpoint");
	});
});

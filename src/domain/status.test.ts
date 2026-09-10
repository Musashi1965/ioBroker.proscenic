import { expect } from "chai";
import { normalizeStatus20001 } from "./status";

describe("normalizeStatus20001", () => {
	it("projects only the initial read-only status structure", () => {
		const status = normalizeStatus20001({
			allArea: 1234,
			allTime: 5678,
			autoBoost: false,
			cleanArea: 12,
			cleanComponents: true,
			cleanTime: 34,
			elec: 88,
			elecReal: 89,
			errorState: [{ code: 1 }, { code: 2 }],
			map: "private-map",
			mode: "sweep",
			mop: 0,
			pos: [1, 2],
			subMode: "total",
			water: 2,
			workNoisy: "strong",
		});

		expect(status).to.deep.equal({
			autoBoost: false,
			batteryPercent: 88,
			batteryRawPercent: 89,
			cleanArea: 12,
			cleanComponents: true,
			cleanTime: 34,
			errorRawCount: 2,
			fanMode: "strong",
			mode: "sweep",
			mopMode: 0,
			subMode: "total",
			totalArea: 1234,
			totalTime: 5678,
			waterLevel: 2,
		});
	});

	it("ignores malformed status payloads", () => {
		expect(normalizeStatus20001(null)).to.equal(undefined);
		expect(normalizeStatus20001([])).to.equal(undefined);
		expect(normalizeStatus20001("status")).to.equal(undefined);
	});
});

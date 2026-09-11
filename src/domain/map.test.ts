import { expect } from "chai";
import { normalizeMap20002 } from "./map";

describe("normalizeMap20002", () => {
	it("projects only safe map metadata", () => {
		const map = normalizeMap20002({
			SN: "private-serial",
			area: [{ id: 1 }, { id: 2 }],
			chargeHandlePos: [1, 2],
			height: 98,
			lz4_len: 935,
			map: "encoded-private-map",
			mapId: 123,
			pathId: 456,
			pos: [3, 4],
			resolution: 0.05,
			width: 109,
			x_min: -4.93,
			y_min: -2.83,
		});

		expect(map).to.deep.equal({
			areaCount: 2,
			available: true,
			compressedBytes: 935,
			encodedBytes: 19,
			height: 98,
			mapId: 123,
			pathId: 456,
			resolution: 0.05,
			width: 109,
		});
	});

	it("ignores malformed map payloads", () => {
		expect(normalizeMap20002(null)).to.equal(undefined);
		expect(normalizeMap20002([])).to.equal(undefined);
		expect(normalizeMap20002("map")).to.equal(undefined);
		expect(normalizeMap20002({ SN: "private-serial" })).to.equal(undefined);
	});
});

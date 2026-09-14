import { expect } from "chai";
import { normalizeConsumables21015 } from "./consumables";

describe("normalizeConsumables21015", () => {
	it("normalizes verified used-second counters and preserves overdue percentages", () => {
		const consumables = normalizeConsumables21015({
			filter: 458_996,
			sideBrush: 458_996,
			mainBrush: 458_996,
			sensors: 458_996,
			battery: 2_956_555,
		});

		expect(consumables?.filter?.usedSeconds).to.equal(458_996);
		expect(consumables?.filter?.intervalHours).to.equal(150);
		expect(consumables?.filter?.remainingPercent).to.be.closeTo(15.00074074074074, 0.000000000001);
		expect(consumables?.filter?.overdueHours).to.equal(0);
		expect(consumables?.sideBrush?.remainingPercent).to.be.closeTo(36.25055555555556, 0.000000000001);
		expect(consumables?.mainBrush?.remainingPercent).to.be.closeTo(57.50037037037037, 0.000000000001);
		expect(consumables?.sensors?.remainingPercent).to.be.closeTo(-324.9962962962963, 0.000000000001);
		expect(consumables?.sensors?.overdueHours).to.be.closeTo(97.49888888888889, 0.000000000001);
		expect(consumables).to.not.have.property("battery");
	});

	it("ignores malformed payloads and invalid counters", () => {
		expect(normalizeConsumables21015(null)).to.equal(undefined);
		expect(normalizeConsumables21015([])).to.equal(undefined);
		expect(normalizeConsumables21015({ filter: -1, sideBrush: "42" })).to.equal(undefined);
	});
});

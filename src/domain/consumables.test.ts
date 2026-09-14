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
		expect(consumables?.filter?.remainingPercent).to.equal(15);
		expect(consumables?.filter?.overdueHours).to.equal(0);
		expect(consumables?.sideBrush?.remainingPercent).to.equal(36.25);
		expect(consumables?.mainBrush?.remainingPercent).to.equal(57.5);
		expect(consumables?.sensors?.remainingPercent).to.equal(-325);
		expect(consumables?.sensors?.overdueHours).to.equal(97.5);
		expect(consumables).to.not.have.property("battery");
	});

	it("ignores malformed payloads and invalid counters", () => {
		expect(normalizeConsumables21015(null)).to.equal(undefined);
		expect(normalizeConsumables21015([])).to.equal(undefined);
		expect(normalizeConsumables21015({ filter: -1, sideBrush: "42" })).to.equal(undefined);
	});
});

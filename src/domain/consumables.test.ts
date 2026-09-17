import { expect } from "chai";
import {
	buildConsumableResetRequest,
	consumableCounterSnapshotsEqual,
	consumableResetForStateId,
	isConsumableResetConfirmation,
	normalizeConsumableCounterSnapshot,
	normalizeConsumables21015,
	runSafeConsumableReset,
} from "./consumables";

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

describe("safe consumable resets", () => {
	const before = {
		filter: 458_996,
		mainBrush: 458_996,
		sideBrush: 458_996,
		sensors: 458_996,
		battery: 12_345,
	};

	it("accepts only a complete bounded integer counter snapshot", () => {
		expect(normalizeConsumableCounterSnapshot(before)).to.deep.equal(before);
		expect(normalizeConsumableCounterSnapshot({ ...before, battery: undefined })).to.equal(undefined);
		expect(normalizeConsumableCounterSnapshot({ ...before, sensors: -1 })).to.equal(undefined);
		expect(normalizeConsumableCounterSnapshot({ ...before, filter: 1.5 })).to.equal(undefined);
		expect(normalizeConsumableCounterSnapshot({ ...before, unknownCounter: 42 })).to.equal(undefined);
	});

	it("builds a JSON 21016 request that changes only the selected counter", () => {
		expect(buildConsumableResetRequest("sensors", before, "serial value", "user@example.invalid")).to.deep.equal({
			path: "/instructions/cmd21016/serial%20value?username=user%40example.invalid",
			contentType: "application/json;charset=UTF-8",
			body: JSON.stringify({ ...before, sensors: 0 }),
		});
	});

	it("requires the selected counter to be zero and every other counter to remain unchanged", () => {
		const reset = { ...before, sensors: 0 };
		expect(isConsumableResetConfirmation(before, reset, "sensors")).to.equal(true);
		expect(isConsumableResetConfirmation(before, { ...reset, filter: 0 }, "sensors")).to.equal(false);
		expect(isConsumableResetConfirmation(before, { ...reset, sensors: 1 }, "sensors")).to.equal(false);
		expect(consumableCounterSnapshotsEqual(reset, { ...reset })).to.equal(true);
		expect(consumableCounterSnapshotsEqual(reset, { ...reset, battery: 12_346 })).to.equal(false);
	});

	it("maps only the four reset button state IDs", () => {
		expect(consumableResetForStateId("consumables.filter.reset")).to.equal("filter");
		expect(consumableResetForStateId("consumables.sensors.reset")).to.equal("sensors");
		expect(consumableResetForStateId("consumables.filter.usedSeconds")).to.equal(undefined);
	});

	it("performs one read, one reset, and one exact persistence read in order", async () => {
		const steps: string[] = [];
		const reads = [before, { ...before, sensors: 0 }];
		const result = await runSafeConsumableReset("sensors", {
			readSnapshot: () => {
				steps.push("read");
				return Promise.resolve(reads.shift()!);
			},
			sendReset: snapshot => {
				steps.push("send");
				expect(snapshot).to.deep.equal(before);
				return Promise.resolve({ ...snapshot, sensors: 0 });
			},
			onProgress: progress => {
				steps.push(progress);
				return Promise.resolve();
			},
		});

		expect(result).to.equal("verified");
		expect(steps).to.deep.equal([
			"reading-before-reset",
			"read",
			"sending",
			"send",
			"echo-confirmed",
			"verifying-readback",
			"read",
			"verified",
		]);
	});

	it("does not write or retry when the fresh counter is already zero", async () => {
		let sends = 0;
		let reads = 0;
		const result = await runSafeConsumableReset("sensors", {
			readSnapshot: () => {
				reads += 1;
				return Promise.resolve({ ...before, sensors: 0 });
			},
			sendReset: () => {
				sends += 1;
				return Promise.resolve(before);
			},
			onProgress: () => Promise.resolve(),
		});

		expect(result).to.equal("already-zero");
		expect(reads).to.equal(1);
		expect(sends).to.equal(0);
	});

	it("stops after one unsafe echo and never performs the readback", async () => {
		let reads = 0;
		let sends = 0;
		let error: unknown;
		try {
			await runSafeConsumableReset("sensors", {
				readSnapshot: () => {
					reads += 1;
					return Promise.resolve(before);
				},
				sendReset: () => {
					sends += 1;
					return Promise.resolve({ ...before, filter: 0, sensors: 0 });
				},
				onProgress: () => Promise.resolve(),
			});
		} catch (caught) {
			error = caught;
		}

		expect(error).to.be.instanceOf(Error);
		expect((error as Error).message).to.include("unexpected counters");
		expect(reads).to.equal(1);
		expect(sends).to.equal(1);
	});
});

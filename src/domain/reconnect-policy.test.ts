import { expect } from "chai";
import { reconnectDelayMs } from "./reconnect-policy";

describe("reconnectDelayMs", () => {
	it("uses bounded exponential backoff", () => {
		const options = {
			initialDelayMs: 1_000,
			maxDelayMs: 10_000,
			factor: 2,
		};

		expect(reconnectDelayMs(1, options)).to.equal(1_000);
		expect(reconnectDelayMs(2, options)).to.equal(2_000);
		expect(reconnectDelayMs(3, options)).to.equal(4_000);
		expect(reconnectDelayMs(5, options)).to.equal(10_000);
	});

	it("rejects invalid attempts", () => {
		expect(() => reconnectDelayMs(0)).to.throw("Reconnect attempt must be a positive safe integer");
		expect(() => reconnectDelayMs(1.5)).to.throw("Reconnect attempt must be a positive safe integer");
	});
});

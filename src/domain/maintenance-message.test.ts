import { expect } from "chai";
import { normalizeMaintenanceMessage20003 } from "./maintenance-message";

describe("normalizeMaintenanceMessage20003", () => {
	it("normalizes safe event fields without assuming warning severity", () => {
		const message = normalizeMaintenanceMessage20003({
			code: 6131,
			level: 1,
			title: "Event",
			msg: {
				code: 6131,
				message: "Collection started",
			},
		});

		expect(message).to.deep.equal({
			code: 6131,
			level: 1,
			title: "Event",
			message: "Collection started",
			details: JSON.stringify({
				infoType: 20003,
				code: 6131,
				level: 1,
				title: "Event",
				message: "Collection started",
			}),
		});
	});

	it("redacts sensitive text and ignores malformed payloads", () => {
		const message = normalizeMaintenanceMessage20003({
			level: 2,
			msg: {
				message: "Contact user@example.com at 192.0.2.10:443",
			},
		});

		expect(message?.message).to.equal("Contact <redacted-email> at <redacted-address>");
		expect(normalizeMaintenanceMessage20003(null)).to.equal(undefined);
		expect(normalizeMaintenanceMessage20003([])).to.equal(undefined);
		expect(normalizeMaintenanceMessage20003({})).to.equal(undefined);
	});
});

import { expect } from "chai";
import { normalizeMaintenanceHistory20003, normalizeMaintenanceMessage20003 } from "./maintenance-message";

describe("normalizeMaintenanceMessage20003", () => {
	it("normalizes safe event fields without assuming warning severity", () => {
		const message = normalizeMaintenanceMessage20003({
			code: "6131",
			level: 1,
			title: "Event",
			msg: {
				code: 6131,
				message: "Collection started",
			},
			timestamp: 1_789_398_000_000,
		});

		expect(message).to.deep.equal({
			code: 6131,
			level: 1,
			title: "Event",
			message: "Collection started",
			eventTime: "2026-09-14T15:00:00.000Z",
			details: JSON.stringify({
				infoType: 20003,
				code: 6131,
				level: 1,
				title: "Event",
				message: "Collection started",
				eventTime: "2026-09-14T15:00:00.000Z",
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

	it("normalizes bounded REST message history without private identifiers", () => {
		const history = normalizeMaintenanceHistory20003({
			totalElements: 42,
			totalPages: 5,
			number: 0,
			size: 10,
			content: [
				{
					tenement: "private",
					id: "private",
					sn: "private",
					code: "6132",
					level: 1,
					title: "unkonw",
					msg: "The dust bag seems to be full",
					createdDate: "2026-09-14T08:49:23.000Z",
				},
			],
		});

		expect(history).to.deep.equal({
			messages: [
				{
					code: 6132,
					level: 1,
					title: "unkonw",
					message: "The dust bag seems to be full",
					eventTime: "2026-09-14T08:49:23.000Z",
					details: JSON.stringify({
						infoType: 20003,
						code: 6132,
						level: 1,
						title: "unkonw",
						message: "The dust bag seems to be full",
						eventTime: "2026-09-14T08:49:23.000Z",
					}),
				},
			],
			totalElements: 42,
			totalPages: 5,
			page: 0,
			size: 10,
		});
		expect(JSON.stringify(history)).to.not.contain("private");
	});
});

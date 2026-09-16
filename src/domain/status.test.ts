import { expect } from "chai";
import { deriveRobotActivity, normalizeStatus20001 } from "./status";

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
			maintenanceDetails:
				'[{"index":0,"keys":["code"],"values":{"code":1}},{"index":1,"keys":["code"],"values":{"code":2}}]',
			maintenanceMessage: "Maintenance warning reported by robot",
			maintenanceWarning: true,
			maintenanceWarningCount: 2,
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

	it("redacts sensitive maintenance diagnostics", () => {
		const status = normalizeStatus20001({
			errorState: [
				{
					code: 42,
					email: "person@example.com",
					host: "gateway.example.com",
					message: "Contact user@example.com at 192.0.2.10:443",
					pos: [1, 2],
					SN: "private-serial",
				},
			],
		});

		expect(status?.maintenanceDetails).to.equal(
			'[{"index":0,"keys":["code","message"],"values":{"code":42,"message":"Contact <redacted-email> at <redacted-address>"}}]',
		);
	});
});

describe("deriveRobotActivity", () => {
	it("uses the gateway connection as the primary availability signal", () => {
		expect(
			deriveRobotActivity({
				cloudConnected: false,
				gatewayConnected: false,
			}),
		).to.equal("offline");
		expect(
			deriveRobotActivity({
				cloudConnected: true,
				gatewayConnected: false,
			}),
		).to.equal("reconnecting");
		expect(
			deriveRobotActivity({
				cloudConnected: true,
				gatewayConnected: true,
			}),
		).to.equal("online");
	});

	it("maps reliable raw gateway modes to display activity", () => {
		expect(
			deriveRobotActivity({
				cloudConnected: true,
				gatewayConnected: true,
				status: { mode: "sweep" },
			}),
		).to.equal("cleaning");
		expect(
			deriveRobotActivity({
				cloudConnected: true,
				gatewayConnected: true,
				status: { mode: "pause" },
			}),
		).to.equal("paused");
		expect(
			deriveRobotActivity({
				cloudConnected: true,
				gatewayConnected: true,
				status: { mode: "backcharge" },
			}),
		).to.equal("returning");
		expect(
			deriveRobotActivity({
				cloudConnected: true,
				gatewayConnected: true,
				status: { mode: "charge" },
			}),
		).to.equal("charging");
		expect(
			deriveRobotActivity({
				cloudConnected: true,
				gatewayConnected: true,
				status: { mode: "fullcharge" },
			}),
		).to.equal("docked");
	});

	it("keeps a moving robot in cleaning activity when the raw mode claims it is docked", () => {
		expect(
			deriveRobotActivity({
				cloudConnected: true,
				gatewayConnected: true,
				previousStatus: { cleanArea: 42, cleanTime: 2_700, mode: "fullcharge" },
				status: { cleanArea: 43, cleanTime: 2_755, mode: "fullcharge" },
			}),
		).to.equal("cleaning");
	});

	it("holds recent inferred cleaning activity across short stale raw mode reports", () => {
		expect(
			deriveRobotActivity({
				cloudConnected: true,
				gatewayConnected: true,
				cleaningInferredUntilMs: 20_000,
				nowMs: 10_000,
				status: { mode: "fullcharge" },
			}),
		).to.equal("cleaning");
	});
});

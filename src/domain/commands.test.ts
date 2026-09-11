import { expect } from "chai";
import { buildCommandRequest, commandForStateId } from "./commands";

describe("buildCommandRequest", () => {
	it("builds the first public adapter command requests", () => {
		expect(buildCommandRequest("start", "serial value", "user@example.invalid")).to.deep.equal({
			path: "/instructions/cmd21005/serial%20value?username=user%40example.invalid",
			body: "cleanMode=sweepOnly",
		});
		expect(buildCommandRequest("pause", "serial", "user@example.invalid")).to.deep.equal({
			path: "/instructions/serial/21017?username=user%40example.invalid",
			body: "mode=pause",
		});
		expect(buildCommandRequest("continue", "serial", "user@example.invalid")).to.deep.equal({
			path: "/instructions/serial/21017?username=user%40example.invalid",
			body: "pauseOrContinue=continue",
		});
		expect(buildCommandRequest("return", "serial", "user@example.invalid")).to.deep.equal({
			path: "/instructions/serial/21012?username=user%40example.invalid",
			body: "charge=start",
		});
	});

	it("builds fan speed, deep cleaning, and dust collection requests", () => {
		expect(buildCommandRequest("fanQuiet", "serial", "user@example.invalid")).to.deep.equal({
			path: "/instructions/serial/21022?username=user%40example.invalid",
			body: "setMode=quiet",
		});
		expect(buildCommandRequest("fanStandard", "serial", "user@example.invalid")).to.deep.equal({
			path: "/instructions/serial/21022?username=user%40example.invalid",
			body: "setMode=auto",
		});
		expect(buildCommandRequest("fanStrong", "serial", "user@example.invalid")).to.deep.equal({
			path: "/instructions/serial/21022?username=user%40example.invalid",
			body: "setMode=strong",
		});
		expect(buildCommandRequest("deepCleaning", "serial", "user@example.invalid")).to.deep.equal({
			path: "/instructions/cmd21005_2/serial?username=user%40example.invalid",
			body: "mode=depthTotalClean",
		});
		expect(
			buildCommandRequest("collectDust", "serial", "user@example.invalid", new Date("2026-09-11T10:00:00.000Z")),
		).to.deep.equal({
			path: "/instructions/cmd/serial?username=user%40example.invalid",
			contentType: "application/json;charset=UTF-8",
			body: JSON.stringify({
				dInfo: {
					ts: "1789120800000",
					userId: "user@example.invalid",
				},
				data: {
					cmd: "startDustCenter",
					value: 0,
				},
				infoType: 21024,
			}),
		});
	});
});

describe("commandForStateId", () => {
	it("maps only adapter command state IDs", () => {
		expect(commandForStateId("commands.start")).to.equal("start");
		expect(commandForStateId("commands.fan.standard")).to.equal("fanStandard");
		expect(commandForStateId("status.mode")).to.equal(undefined);
	});
});

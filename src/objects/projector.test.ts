import { expect } from "chai";
import {
	projectDevice,
	projectLiveMapImage,
	projectMapMetadata,
	redactedErrorMessage,
	setConnectionState,
} from "./projector";

describe("redactedErrorMessage", () => {
	it("redacts account and endpoint material from public errors", () => {
		const redacted = redactedErrorMessage(
			new Error("connect ETIMEDOUT user@example.com 192.0.2.10:12345 gateway.example.com:443"),
		);

		expect(redacted).to.equal("connect ETIMEDOUT <redacted-email> <redacted-address> <redacted-host>");
	});
});

describe("setConnectionState", () => {
	it("uses the cloud connection as the adapter-level connection state", async () => {
		const states = new Map<string, ioBroker.SettableState>();
		const adapter = {
			setStateAsync: (id: string, state: ioBroker.SettableState) => {
				states.set(id, state);
				return Promise.resolve();
			},
		} as unknown as ioBroker.Adapter;

		await setConnectionState(adapter, "cloud", true);
		await setConnectionState(adapter, "gateway", false);

		expect(states.get("connection.cloud")).to.deep.equal({ val: true, ack: true });
		expect(states.get("connection.gateway")).to.deep.equal({ val: false, ack: true });
		expect(states.get("info.connection")).to.deep.equal({ val: true, ack: true });
	});
});

describe("projectDevice", () => {
	it("publishes the M7 Pro product image for the verified device model", async () => {
		const states = new Map<string, ioBroker.SettableState>();
		const adapter = {
			setStateAsync: (id: string, state: ioBroker.SettableState) => {
				states.set(id, state);
				return Promise.resolve();
			},
		} as unknown as ioBroker.Adapter;

		await projectDevice(adapter, {
			code: "M7_PRO",
			model: "811_LDS",
			status: true,
		});

		expect(states.get("device.code")).to.deep.equal({ val: "M7_PRO", ack: true });
		expect(states.get("device.model")).to.deep.equal({ val: "811_LDS", ack: true });
		expect(states.get("device.online")).to.deep.equal({ val: true, ack: true });
		expect(states.get("device.image")?.ack).to.equal(true);
		expect(states.get("device.image")?.val)
			.to.be.a("string")
			.and.match(/^data:image\/png;base64,/u);
	});

	it("clears the product image for other device models", async () => {
		const states = new Map<string, ioBroker.SettableState>();
		const adapter = {
			setStateAsync: (id: string, state: ioBroker.SettableState) => {
				states.set(id, state);
				return Promise.resolve();
			},
		} as unknown as ioBroker.Adapter;

		await projectDevice(adapter, {
			code: "OTHER",
			model: "UNKNOWN",
			status: true,
		});

		expect(states.get("device.image")).to.deep.equal({ val: "", ack: true });
	});
});

describe("projectMapMetadata", () => {
	it("publishes safe map metadata and enables the map capability", async () => {
		const states = new Map<string, ioBroker.SettableState>();
		const adapter = {
			setStateAsync: (id: string, state: ioBroker.SettableState) => {
				states.set(id, state);
				return Promise.resolve();
			},
		} as unknown as ioBroker.Adapter;

		await projectMapMetadata(adapter, {
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

		expect(states.get("map.available")).to.deep.equal({ val: true, ack: true });
		expect(states.get("map.id")).to.deep.equal({ val: 123, ack: true });
		expect(states.get("map.pathId")).to.deep.equal({ val: 456, ack: true });
		expect(states.get("map.width")).to.deep.equal({ val: 109, ack: true });
		expect(states.get("map.height")).to.deep.equal({ val: 98, ack: true });
		expect(states.get("map.resolution")).to.deep.equal({ val: 0.05, ack: true });
		expect(states.get("map.areaCount")).to.deep.equal({ val: 2, ack: true });
		expect(states.get("map.compressedBytes")).to.deep.equal({ val: 935, ack: true });
		expect(states.get("map.encodedBytes")).to.deep.equal({ val: 19, ack: true });
		expect(states.get("map.updated")?.ack).to.equal(true);
		expect(states.get("map.updated")?.val).to.be.a("string");
		expect(states.get("capabilities.maps")).to.deep.equal({ val: true, ack: true });
	});
});

describe("projectLiveMapImage", () => {
	it("publishes the experimental rendered map image and render diagnostics", async () => {
		const states = new Map<string, ioBroker.SettableState>();
		const adapter = {
			setStateAsync: (id: string, state: ioBroker.SettableState) => {
				states.set(id, state);
				return Promise.resolve();
			},
		} as unknown as ioBroker.Adapter;

		await projectLiveMapImage(
			adapter,
			{
				dataUrl: "data:image/png;base64,fixture",
				width: 2,
				height: 2,
				poseCount: 3,
				rawPoseCount: 4,
				pathLineSegments: 2,
				skippedPathSegments: 1,
				renderedForbiddenAreaCount: 1,
				renderedRoomAreaCount: 2,
				orientation: "flip-y",
				decompressedBytes: 4,
			},
			{
				renderReason: "pose",
				lastPathId: 456,
				pathResetCount: 1,
				lastPoseUpdated: "2026-09-13T15:00:00.000Z",
				currentAreaCount: 1,
				cachedAreaCount: 3,
				hasCachedStaticOverlays: true,
			},
		);

		expect(states.get("map.live.image")).to.deep.equal({ val: "data:image/png;base64,fixture", ack: true });
		expect(states.get("map.live.updated")?.ack).to.equal(true);
		expect(states.get("map.live.updated")?.val).to.be.a("string");
		expect(states.get("map.live.orientation")).to.deep.equal({ val: "flip-y", ack: true });
		expect(states.get("map.live.poseCount")).to.deep.equal({ val: 3, ack: true });
		expect(states.get("map.live.rawPoseCount")).to.deep.equal({ val: 4, ack: true });
		expect(states.get("map.live.pathLineSegments")).to.deep.equal({ val: 2, ack: true });
		expect(states.get("map.live.skippedPathSegments")).to.deep.equal({ val: 1, ack: true });
		expect(states.get("map.live.currentAreaCount")).to.deep.equal({ val: 1, ack: true });
		expect(states.get("map.live.cachedAreaCount")).to.deep.equal({ val: 3, ack: true });
		expect(states.get("map.live.renderedForbiddenAreaCount")).to.deep.equal({ val: 1, ack: true });
		expect(states.get("map.live.renderedRoomAreaCount")).to.deep.equal({ val: 2, ack: true });
		expect(states.get("map.live.hasCachedStaticOverlays")).to.deep.equal({ val: true, ack: true });
		expect(states.get("map.live.renderReason")).to.deep.equal({ val: "pose", ack: true });
		expect(states.get("map.live.lastPathId")).to.deep.equal({ val: 456, ack: true });
		expect(states.get("map.live.pathResetCount")).to.deep.equal({ val: 1, ack: true });
		expect(states.get("map.live.lastPoseUpdated")).to.deep.equal({ val: "2026-09-13T15:00:00.000Z", ack: true });
		expect(states.get("map.live.decompressedBytes")).to.deep.equal({ val: 4, ack: true });
		expect(states.get("capabilities.maps")).to.deep.equal({ val: true, ack: true });
	});

	it("clears stale live pose timestamps after a path reset", async () => {
		const states = new Map<string, ioBroker.SettableState>();
		const adapter = {
			setStateAsync: (id: string, state: ioBroker.SettableState) => {
				states.set(id, state);
				return Promise.resolve();
			},
		} as unknown as ioBroker.Adapter;

		await projectLiveMapImage(
			adapter,
			{
				dataUrl: "data:image/png;base64,fixture",
				width: 2,
				height: 2,
				poseCount: 0,
				rawPoseCount: 0,
				pathLineSegments: 0,
				skippedPathSegments: 0,
				renderedForbiddenAreaCount: 0,
				renderedRoomAreaCount: 0,
				orientation: "flip-y",
				decompressedBytes: 4,
			},
			{
				renderReason: "map",
				pathResetCount: 2,
				currentAreaCount: 0,
				cachedAreaCount: 0,
				hasCachedStaticOverlays: false,
			},
		);

		expect(states.get("map.live.lastPoseUpdated")).to.deep.equal({ val: "", ack: true });
	});
});

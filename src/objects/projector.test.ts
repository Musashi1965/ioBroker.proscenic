import { expect } from "chai";
import { projectMapMetadata, redactedErrorMessage, setConnectionState } from "./projector";

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

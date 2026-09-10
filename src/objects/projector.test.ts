import { expect } from "chai";
import { redactedErrorMessage, setConnectionState } from "./projector";

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

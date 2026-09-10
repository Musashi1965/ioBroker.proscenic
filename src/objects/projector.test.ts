import { expect } from "chai";
import { redactedErrorMessage } from "./projector";

describe("redactedErrorMessage", () => {
	it("redacts account and endpoint material from public errors", () => {
		const redacted = redactedErrorMessage(
			new Error("connect ETIMEDOUT user@example.com 192.0.2.10:12345 gateway.example.com:443"),
		);

		expect(redacted).to.equal("connect ETIMEDOUT <redacted-email> <redacted-address> <redacted-host>");
	});
});

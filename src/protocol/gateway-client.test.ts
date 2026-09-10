import { createCipheriv } from "node:crypto";
import { expect } from "chai";
import { parseGatewayFrame, parseGatewayFrameResult } from "./gateway-client";

describe("parseGatewayFrame", () => {
	it("decrypts encrypted gateway status frames", () => {
		const token = "0123456789abcdef";
		const plaintext = JSON.stringify({
			infoType: 20001,
			data: {
				mode: "charge",
			},
		});
		const cipher = createCipheriv("aes-128-ecb", Buffer.from(token), null);
		cipher.setAutoPadding(true);
		const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");

		expect(parseGatewayFrame(JSON.stringify({ encrypt: true, data: encrypted }), token)).to.deep.equal({
			encrypted: true,
			infoType: 20001,
			data: {
				mode: "charge",
			},
		});
	});
});

describe("parseGatewayFrameResult", () => {
	it("returns parse errors without throwing", () => {
		const result = parseGatewayFrameResult(
			JSON.stringify({ encrypt: true, data: "not-valid-ciphertext" }),
			"0123456789abcdef",
		);

		expect(result.event).to.equal(undefined);
		expect(result.error).to.be.instanceOf(Error);
	});
});

import { createCipheriv } from "node:crypto";
import { expect } from "chai";
import { parseGatewayFrame } from "./gateway-client";

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

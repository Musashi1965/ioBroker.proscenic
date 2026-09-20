import { expect } from "chai";
import { mapZoneCatalogPath } from "./rest-client";

describe("Proscenic REST paths", () => {
	it("encodes the verified 21004 map zone catalog request path", () => {
		expect(mapZoneCatalogPath("serial/value", "account+test@example.invalid")).to.equal(
			"/instructions/cmd21004/serial%2Fvalue?username=account%2Btest%40example.invalid",
		);
	});
});

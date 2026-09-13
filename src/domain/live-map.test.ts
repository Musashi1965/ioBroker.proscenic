import { expect } from "chai";
import { extractRobotPose20001, renderLiveMapImage20002 } from "./live-map";

describe("live map rendering", () => {
	it("renders a flip-y PNG data URL from a self-contained 20002 occupancy grid", () => {
		const grid = Buffer.from([0, 127, 255, 255, 127, 0]);
		const image = renderLiveMapImage20002({
			map: encodeLiteralOnlyLz4(grid).toString("base64"),
			width: 3,
			height: 2,
			resolution: 0.05,
			x_min: 0,
			y_min: 0,
			chargeHandlePos: [50, 0],
			area: [
				{
					vertexs: [
						[0, 0],
						[100, 0],
						[100, 50],
						[0, 50],
					],
				},
			],
		});

		expect(image?.orientation).to.equal("flip-y");
		expect(image?.width).to.equal(3);
		expect(image?.height).to.equal(2);
		expect(image?.decompressedBytes).to.equal(grid.length);
		expect(image?.dataUrl.startsWith("data:image/png;base64,")).to.equal(true);
		expect(decodePngDataUrl(image?.dataUrl)[25]).to.equal(2);
	});

	it("extracts private robot positions only for in-memory rendering", () => {
		expect(extractRobotPose20001({ pos: [1_000, 2_000], phi: 1_570 })).to.deep.equal({
			pos: [1_000, 2_000],
			phi: 1_570,
		});
		expect(extractRobotPose20001({ pos: "redacted" })).to.equal(undefined);
	});
});

function encodeLiteralOnlyLz4(payload: Buffer): Buffer {
	const chunks: Buffer[] = [];
	let remaining = payload.length;
	const firstLength = Math.min(remaining, 15);
	const token = firstLength << 4;
	chunks.push(Buffer.from([token]));
	remaining -= firstLength;
	while (remaining >= 255) {
		chunks.push(Buffer.from([255]));
		remaining -= 255;
	}
	if (payload.length >= 15) {
		chunks.push(Buffer.from([remaining]));
	}
	chunks.push(payload);
	return Buffer.concat(chunks);
}

function decodePngDataUrl(dataUrl: string | undefined): Buffer {
	expect(dataUrl).to.be.a("string");
	const encoded = dataUrl?.slice("data:image/png;base64,".length) ?? "";
	return Buffer.from(encoded, "base64");
}

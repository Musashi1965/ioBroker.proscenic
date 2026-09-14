import { expect } from "chai";
import { inflateSync } from "node:zlib";
import {
	extractLiveMapCoordinateMetadata20002,
	extractRobotPose20001,
	mergeLiveMapCoordinateMetadataCache,
	mergeLiveMapCoordinateMetadata20002,
	renderLiveMapImage20002,
} from "./live-map";

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
		expect(image?.rawPoseCount).to.equal(0);
		expect(image?.poseCount).to.equal(0);
		expect(image?.pathLineSegments).to.equal(0);
		expect(image?.skippedPathSegments).to.equal(0);
		expect(image?.renderedForbiddenAreaCount).to.equal(1);
		expect(image?.renderedRoomAreaCount).to.equal(0);
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

	it("renders no-go areas translucent so map pixels stay visible below them", () => {
		const grid = Buffer.alloc(25, 127);
		const image = renderLiveMapImage20002({
			map: encodeLiteralOnlyLz4(grid).toString("base64"),
			width: 5,
			height: 5,
			resolution: 0.05,
			x_min: 0,
			y_min: 0,
			area: [
				{
					vertexs: [
						[50, 50],
						[150, 50],
						[150, 150],
						[50, 150],
					],
				},
			],
		});

		const pixels = decodeRgbPngDataUrl(image?.dataUrl, 5, 5);
		const center = pixelAt(pixels, 5, 2, 2);

		expect(center).to.not.deep.equal([255, 255, 255]);
		expect(center).to.not.deep.equal([209, 106, 133]);
		expect(center[0]).to.be.lessThan(255);
		expect(center[1]).to.be.lessThan(255);
		expect(center[2]).to.be.lessThan(255);
	});

	it("carries forward cached no-go metadata for later map frames with the same map ID", () => {
		const grid = Buffer.alloc(25, 127);
		const mapWithArea = {
			map: encodeLiteralOnlyLz4(grid).toString("base64"),
			mapId: 42,
			width: 5,
			height: 5,
			resolution: 0.05,
			x_min: 0,
			y_min: 0,
			area: [
				{
					vertexs: [
						[50, 50],
						[150, 50],
						[150, 150],
						[50, 150],
					],
				},
			],
		};
		const laterMapWithoutArea = {
			map: encodeLiteralOnlyLz4(grid).toString("base64"),
			mapId: 42,
			width: 5,
			height: 5,
			resolution: 0.05,
			x_min: 0,
			y_min: 0,
		};

		const metadata = extractLiveMapCoordinateMetadata20002(mapWithArea);
		const merged = mergeLiveMapCoordinateMetadata20002(laterMapWithoutArea, metadata);
		const image = renderLiveMapImage20002(merged);
		const pixels = decodeRgbPngDataUrl(image?.dataUrl, 5, 5);

		expect(pixelAt(pixels, 5, 2, 2)).to.not.deep.equal([255, 255, 255]);
	});

	it("does not carry cached no-go metadata across different map IDs", () => {
		const grid = Buffer.alloc(25, 127);
		const metadata = extractLiveMapCoordinateMetadata20002({
			map: encodeLiteralOnlyLz4(grid).toString("base64"),
			mapId: 42,
			width: 5,
			height: 5,
			resolution: 0.05,
			x_min: 0,
			y_min: 0,
			area: [
				{
					vertexs: [
						[50, 50],
						[150, 50],
						[150, 150],
						[50, 150],
					],
				},
			],
		});
		const merged = mergeLiveMapCoordinateMetadata20002(
			{
				map: encodeLiteralOnlyLz4(grid).toString("base64"),
				mapId: 43,
				width: 5,
				height: 5,
				resolution: 0.05,
				x_min: 0,
				y_min: 0,
			},
			metadata,
		);
		const image = renderLiveMapImage20002(merged);
		const pixels = decodeRgbPngDataUrl(image?.dataUrl, 5, 5);

		expect(pixelAt(pixels, 5, 2, 2)).to.deep.equal([255, 255, 255]);
	});

	it("renders the room white, the unknown background blue, and path lines with their own green overlay color", () => {
		const width = 20;
		const height = 20;
		const grid = Buffer.alloc(width * height, 255);
		for (let y = 0; y < height; y++) {
			grid[y * width + 10] = 127;
		}
		const image = renderLiveMapImage20002(
			{
				map: encodeLiteralOnlyLz4(grid).toString("base64"),
				width,
				height,
				resolution: 0.05,
				x_min: 0,
				y_min: 0,
			},
			[{ pos: [500, 0] }, { pos: [500, 950] }],
		);

		const pixels = decodeRgbPngDataUrl(image?.dataUrl, width, height);

		expect(pixelAt(pixels, width, 0, 10)).to.deep.equal([184, 204, 216]);
		expect(pixelAt(pixels, width, 10, 10)).to.deep.equal([126, 216, 96]);
		expect(pixelAt(pixels, width, 10, 10)).to.not.deep.equal(pixelAt(pixels, width, 0, 10));
		expect(pixelAt(pixels, width, 10, 10)).to.not.deep.equal([255, 255, 255]);
		expect(image?.rawPoseCount).to.equal(2);
		expect(image?.poseCount).to.equal(2);
		expect(image?.pathLineSegments).to.equal(1);
		expect(image?.skippedPathSegments).to.equal(0);
	});

	it("connects moderate gateway pose gaps so the visible path remains continuous", () => {
		const width = 100;
		const height = 100;
		const grid = Buffer.alloc(width * height, 127);
		const image = renderLiveMapImage20002(
			{
				map: encodeLiteralOnlyLz4(grid).toString("base64"),
				width,
				height,
				resolution: 0.05,
				x_min: 0,
				y_min: 0,
			},
			[{ pos: [500, 500] }, { pos: [3_500, 500] }],
		);
		const pixels = decodeRgbPngDataUrl(image?.dataUrl, width, height);

		expect(image?.pathLineSegments).to.equal(1);
		expect(image?.skippedPathSegments).to.equal(0);
		expect(pixelAt(pixels, width, 40, 89)).to.deep.equal([126, 216, 96]);
	});

	it("routes moderate pose gaps around wall pixels instead of drawing through walls", () => {
		const width = 20;
		const height = 20;
		const grid = Buffer.alloc(width * height, 127);
		for (let renderedY = 0; renderedY <= 15; renderedY++) {
			setRenderedGridPixel(grid, width, height, 10, renderedY, 0);
		}
		const image = renderLiveMapImage20002(
			{
				map: encodeLiteralOnlyLz4(grid).toString("base64"),
				width,
				height,
				resolution: 0.05,
				x_min: 0,
				y_min: 0,
			},
			[{ pos: [250, 450] }, { pos: [750, 450] }],
		);
		const pixels = decodeRgbPngDataUrl(image?.dataUrl, width, height);

		expect(image?.pathLineSegments).to.equal(1);
		expect(image?.skippedPathSegments).to.equal(0);
		expect(pixelAt(pixels, width, 10, 5)).to.deep.equal([56, 130, 188]);
		expect(pixelAt(pixels, width, 10, 16)).to.deep.equal([126, 216, 96]);
	});

	it("keeps deduplicated room zones when later frames only contain the no-go area", () => {
		const grid = Buffer.alloc(100, 127);
		const fullMap = {
			map: encodeLiteralOnlyLz4(grid).toString("base64"),
			mapId: 42,
			width: 10,
			height: 10,
			resolution: 0.05,
			x_min: 0,
			y_min: 0,
			area: [
				area(1003, [
					[50, 50],
					[150, 50],
					[150, 150],
					[50, 150],
				]),
				area(1001, [
					[250, 50],
					[350, 50],
					[350, 150],
					[250, 150],
				]),
				area(1002, [
					[250, 250],
					[350, 250],
					[350, 350],
					[250, 350],
				]),
				area(1003, [
					[50, 50],
					[150, 50],
					[150, 150],
					[50, 150],
				]),
			],
		};
		const laterMapWithOnlyNoGo = {
			map: encodeLiteralOnlyLz4(grid).toString("base64"),
			mapId: 42,
			width: 10,
			height: 10,
			resolution: 0.05,
			x_min: 0,
			y_min: 0,
			area: [
				area(1003, [
					[50, 50],
					[150, 50],
					[150, 150],
					[50, 150],
				]),
			],
		};

		const fullMetadata = extractLiveMapCoordinateMetadata20002(fullMap);
		const laterMetadata = extractLiveMapCoordinateMetadata20002(laterMapWithOnlyNoGo);
		const cached = laterMetadata ? mergeLiveMapCoordinateMetadataCache(fullMetadata, laterMetadata) : fullMetadata;
		const merged = mergeLiveMapCoordinateMetadata20002(laterMapWithOnlyNoGo, cached);
		const image = renderLiveMapImage20002(merged);
		const pixels = decodeRgbPngDataUrl(image?.dataUrl, 10, 10);

		expect(cached?.area?.map(entry => entry.key)).to.have.members(["id:1001", "id:1002", "id:1003"]);
		expect(image?.renderedForbiddenAreaCount).to.equal(1);
		expect(image?.renderedRoomAreaCount).to.equal(2);
		expect(pixelAt(pixels, 10, 2, 2)).to.not.deep.equal(pixelAt(pixels, 10, 6, 2));
	});

	it("skips implausible path jumps without dropping later plausible segments", () => {
		const width = 100;
		const height = 100;
		const grid = Buffer.alloc(width * height, 127);
		const image = renderLiveMapImage20002(
			{
				map: encodeLiteralOnlyLz4(grid).toString("base64"),
				width,
				height,
				resolution: 0.05,
				x_min: 0,
				y_min: 0,
			},
			[{ pos: [500, 500] }, { pos: [4_900, 4_900] }, { pos: [4_500, 4_900] }],
		);

		expect(image?.rawPoseCount).to.equal(3);
		expect(image?.poseCount).to.equal(3);
		expect(image?.pathLineSegments).to.equal(1);
		expect(image?.skippedPathSegments).to.equal(1);
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

function area(id: number, vertexs: Array<[number, number]>): Record<string, unknown> {
	return { id, vertexs, forbidType: "all" };
}

function setRenderedGridPixel(
	grid: Buffer,
	width: number,
	height: number,
	x: number,
	renderedY: number,
	value: number,
): void {
	const sourceY = height - 1 - renderedY;
	grid[sourceY * width + x] = value;
}

function decodePngDataUrl(dataUrl: string | undefined): Buffer {
	expect(dataUrl).to.be.a("string");
	const encoded = dataUrl?.slice("data:image/png;base64,".length) ?? "";
	return Buffer.from(encoded, "base64");
}

function decodeRgbPngDataUrl(dataUrl: string | undefined, width: number, height: number): Buffer {
	const png = decodePngDataUrl(dataUrl);
	const idat = extractPngChunk(png, "IDAT");
	const scanlines = inflateSync(idat);
	const pixels = Buffer.alloc(width * height * 3);
	const rowBytes = width * 3;

	for (let y = 0; y < height; y++) {
		expect(scanlines[y * (rowBytes + 1)]).to.equal(0);
		scanlines.copy(pixels, y * rowBytes, y * (rowBytes + 1) + 1, y * (rowBytes + 1) + 1 + rowBytes);
	}

	return pixels;
}

function extractPngChunk(png: Buffer, type: string): Buffer {
	let offset = 8;
	while (offset + 8 <= png.length) {
		const length = png.readUInt32BE(offset);
		const chunkType = png.subarray(offset + 4, offset + 8).toString("ascii");
		const dataStart = offset + 8;
		const dataEnd = dataStart + length;
		if (chunkType === type) {
			return png.subarray(dataStart, dataEnd);
		}
		offset = dataEnd + 4;
	}
	throw new Error(`PNG chunk ${type} not found`);
}

function pixelAt(pixels: Buffer, width: number, x: number, y: number): [number, number, number] {
	const offset = (y * width + x) * 3;
	return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
}

import { expect } from "chai";
import { inflateSync } from "node:zlib";
import {
	DEFAULT_LIVE_MAP_BACKGROUND_COLOR,
	DEFAULT_LIVE_MAP_CANVAS_BACKGROUND_COLOR,
	extractLiveMapCoordinateMetadata20002,
	extractLiveMapZoneCatalog21004,
	extractRobotPose20001,
	mergeLiveMapCoordinateMetadata20002,
	normalizeLiveMapBackgroundColor,
	replaceLiveMapZoneCatalog,
	renderLiveMapImage20002,
	transitionLiveMapTaskState,
} from "./live-map";

describe("live map rendering", () => {
	it("renders a flip-y animated SVG with a static PNG fallback", () => {
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
					__proscenicKind: "forbidden",
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
		expect(image?.renderedZoneAreaCount).to.equal(0);
		expect(image?.renderedRoomAreaCount).to.equal(0);
		expect(image?.areas).to.deep.equal([
			{
				key: "shape:4:0:0:100:50",
				kind: "forbidden",
				bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
			},
		]);
		expect(image?.format).to.equal("svg");
		expect(image?.dataUrl).to.equal(image?.svgDataUrl);
		expect(image?.svgDataUrl.startsWith("data:image/svg+xml;base64,")).to.equal(true);
		expect(image?.pngDataUrl.startsWith("data:image/png;base64,")).to.equal(true);
		expect(decodePngDataUrl(image?.pngDataUrl)[25]).to.equal(2);
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
					__proscenicKind: "forbidden",
					vertexs: [
						[50, 50],
						[150, 50],
						[150, 150],
						[50, 150],
					],
				},
			],
		});

		const pixels = decodeRgbPngDataUrl(image?.pngDataUrl, 5, 5);
		const center = pixelAt(pixels, 5, 2, 2);

		expect(center).to.not.deep.equal([255, 255, 255]);
		expect(center).to.not.deep.equal([209, 106, 133]);
		expect(center[0]).to.be.lessThan(255);
		expect(center[1]).to.be.lessThan(255);
		expect(center[2]).to.be.lessThan(255);
	});

	it("carries forward the 21004 zone catalog for later 20002 frames with the same map ID", () => {
		const grid = Buffer.alloc(25, 127);
		const mapWithArea = {
			map: encodeLiteralOnlyLz4(grid).toString("base64"),
			mapId: 42,
			width: 5,
			height: 5,
			resolution: 0.05,
			x_min: 0,
			y_min: 0,
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

		const baseMetadata = extractLiveMapCoordinateMetadata20002(mapWithArea);
		const catalog = extractLiveMapZoneCatalog21004({
			mapId: 42,
			value: [
				{
					...area(1003, [
						[50, 50],
						[150, 50],
						[150, 150],
						[50, 150],
					]),
					active: "forbid",
				},
			],
		});
		const metadata = catalog ? replaceLiveMapZoneCatalog(baseMetadata, catalog) : baseMetadata;
		const merged = mergeLiveMapCoordinateMetadata20002(laterMapWithoutArea, metadata);
		const image = renderLiveMapImage20002(merged);
		const pixels = decodeRgbPngDataUrl(image?.pngDataUrl, 5, 5);

		expect(pixelAt(pixels, 5, 2, 2)).to.not.deep.equal([255, 255, 255]);
	});

	it("does not carry a 21004 zone catalog across different map IDs", () => {
		const grid = Buffer.alloc(25, 127);
		const baseMetadata = extractLiveMapCoordinateMetadata20002({
			map: encodeLiteralOnlyLz4(grid).toString("base64"),
			mapId: 42,
			width: 5,
			height: 5,
			resolution: 0.05,
			x_min: 0,
			y_min: 0,
		});
		const catalog = extractLiveMapZoneCatalog21004({
			mapId: 42,
			value: [
				{
					...area(1003, [
						[50, 50],
						[150, 50],
						[150, 150],
						[50, 150],
					]),
					active: "forbid",
				},
			],
		});
		const metadata = catalog ? replaceLiveMapZoneCatalog(baseMetadata, catalog) : baseMetadata;
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
		const pixels = decodeRgbPngDataUrl(image?.pngDataUrl, 5, 5);

		expect(pixelAt(pixels, 5, 2, 2)).to.deep.equal([217, 217, 217]);
	});

	it("renders the white background, blue map area, and path lines with their own green overlay color", () => {
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

		const pixels = decodeRgbPngDataUrl(image?.pngDataUrl, width, height);

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
		const pixels = decodeRgbPngDataUrl(image?.pngDataUrl, width, height);

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
		const pixels = decodeRgbPngDataUrl(image?.pngDataUrl, width, height);

		expect(image?.pathLineSegments).to.equal(1);
		expect(image?.skippedPathSegments).to.equal(0);
		expect(pixelAt(pixels, width, 10, 5)).to.deep.equal([56, 130, 188]);
		expect(pixelAt(pixels, width, 10, 16)).to.deep.equal([126, 216, 96]);
	});

	it("uses 21004 as the authoritative saved-zone catalog and replaces removed zones", () => {
		const grid = Buffer.alloc(100, 127);
		const baseMap = {
			map: encodeLiteralOnlyLz4(grid).toString("base64"),
			mapId: 42,
			width: 10,
			height: 10,
			resolution: 0.05,
			x_min: 0,
			y_min: 0,
		};
		const baseMetadata = extractLiveMapCoordinateMetadata20002({
			...baseMap,
			area: [
				area(9999, [
					[0, 0],
					[10, 0],
					[10, 10],
				]),
			],
		});
		const firstCatalog = extractLiveMapZoneCatalog21004({
			mapId: 42,
			value: [
				{
					...area(1001, [
						[250, 50],
						[350, 50],
						[350, 150],
						[250, 150],
					]),
					active: "normal",
				},
				{
					...area(1002, [
						[250, 250],
						[350, 250],
						[350, 350],
						[250, 350],
					]),
					active: "normal",
				},
				{
					...area(1003, [
						[50, 50],
						[150, 50],
						[150, 150],
						[50, 150],
					]),
					active: "forbid",
				},
			],
		});
		const first = firstCatalog ? replaceLiveMapZoneCatalog(baseMetadata, firstCatalog) : baseMetadata;
		const replacementCatalog = extractLiveMapZoneCatalog21004({
			mapId: 42,
			value: [
				{
					...area(1002, [
						[250, 250],
						[350, 250],
						[350, 350],
						[250, 350],
					]),
					active: "normal",
				},
				{
					...area(1003, [
						[50, 50],
						[150, 50],
						[150, 150],
						[50, 150],
					]),
					active: "forbid",
				},
			],
		});
		const cached = replacementCatalog ? replaceLiveMapZoneCatalog(first, replacementCatalog) : first;
		const merged = mergeLiveMapCoordinateMetadata20002(baseMap, cached);
		const image = renderLiveMapImage20002(merged);
		const pixels = decodeRgbPngDataUrl(image?.pngDataUrl, 10, 10);

		expect(baseMetadata?.area).to.equal(undefined);
		expect(cached?.area?.map(entry => entry.key)).to.have.members(["id:1002", "id:1003"]);
		expect(image?.renderedForbiddenAreaCount).to.equal(1);
		expect(image?.renderedZoneAreaCount).to.equal(1);
		expect(image?.renderedRoomAreaCount).to.equal(1);
		expect(image?.areas.map(entry => ({ key: entry.key, kind: entry.kind, id: entry.id }))).to.have.deep.members([
			{ key: "id:1002", kind: "zone", id: 1002 },
			{ key: "id:1003", kind: "forbidden", id: 1003 },
		]);
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

	it("renders writable canvas and map background colors with caller-provided colors", () => {
		const width = 2;
		const height = 1;
		const grid = Buffer.from([255, 127]);
		const image = renderLiveMapImage20002(
			{
				map: encodeLiteralOnlyLz4(grid).toString("base64"),
				width,
				height,
			},
			[],
			{ canvasBackgroundColor: "#dddddd", mapBackgroundColor: "#b8ccd0" },
		);

		const pixels = decodeRgbPngDataUrl(image?.pngDataUrl, width, height);

		expect(pixelAt(pixels, width, 0, 0)).to.deep.equal([184, 204, 208]);
		expect(pixelAt(pixels, width, 1, 0)).to.deep.equal([221, 221, 221]);
	});

	it("can hide zone and forbidden-area overlays without removing their catalog summary", () => {
		const grid = Buffer.alloc(25, 127);
		const image = renderLiveMapImage20002(
			{
				map: encodeLiteralOnlyLz4(grid).toString("base64"),
				width: 5,
				height: 5,
				resolution: 0.05,
				x_min: 0,
				y_min: 0,
				area: [
					{
						id: 1001,
						__proscenicKind: "zone",
						vertexs: [
							[50, 50],
							[150, 50],
							[150, 150],
							[50, 150],
						],
					},
				],
			},
			[],
			{ showZoneOverlays: false },
		);

		expect(image?.areas).to.have.length(1);
		expect(image?.renderedZoneAreaCount).to.equal(0);
		expect(image?.renderedForbiddenAreaCount).to.equal(0);
	});

	it("renders unselected zones white and selected zones light green", () => {
		const width = 9;
		const height = 9;
		const grid = Buffer.alloc(width * height, 127);
		const data = {
			map: encodeLiteralOnlyLz4(grid).toString("base64"),
			width,
			height,
			resolution: 0.05,
			x_min: 0,
			y_min: 0,
			area: [
				{
					id: 1005,
					__proscenicKind: "zone",
					vertexs: [
						[100, 100],
						[300, 100],
						[300, 300],
						[100, 300],
					],
				},
			],
		};
		const unselected = renderLiveMapImage20002(data);
		const selected = renderLiveMapImage20002(data, [], { selectedZoneIds: [1005] });
		const unselectedPixels = decodeRgbPngDataUrl(unselected?.pngDataUrl, width, height);
		const selectedPixels = decodeRgbPngDataUrl(selected?.pngDataUrl, width, height);
		const unselectedCenter = pixelAt(unselectedPixels, width, 4, 4);
		const selectedCenter = pixelAt(selectedPixels, width, 4, 4);
		const unselectedBorder = pixelAt(unselectedPixels, width, 2, 4);

		expect(unselectedCenter[0]).to.equal(unselectedCenter[1]);
		expect(unselectedCenter[1]).to.equal(unselectedCenter[2]);
		expect(unselectedBorder[2]).to.be.greaterThan(unselectedBorder[0]);
		expect(selectedCenter[1]).to.be.greaterThan(selectedCenter[0]);
		expect(selectedCenter[1]).to.be.greaterThan(selectedCenter[2]);
	});

	it("renders bounded escaped saved-zone names in the SVG overlay", () => {
		const width = 20;
		const height = 20;
		const grid = Buffer.alloc(width * height, 127);
		const data = {
			map: encodeLiteralOnlyLz4(grid).toString("base64"),
			width,
			height,
			resolution: 0.05,
			x_min: 0,
			y_min: 0,
			area: [
				{
					id: 1005,
					name: " Flur & Bad <Nord> ",
					__proscenicKind: "zone",
					vertexs: [
						[100, 100],
						[600, 100],
						[600, 600],
						[100, 600],
					],
				},
			],
		};
		const visible = renderLiveMapImage20002(data);
		const hidden = renderLiveMapImage20002(data, [], { showZoneOverlays: false });
		const visibleSvg = decodeSvgDataUrl(visible?.svgDataUrl);
		const hiddenSvg = decodeSvgDataUrl(hidden?.svgDataUrl);

		expect(visible?.areas[0]?.label).to.equal("Flur & Bad <Nord>");
		expect(visibleSvg).to.include("Flur &amp; Bad &lt;Nord&gt;");
		expect(visibleSvg).to.include('text-anchor="middle"');
		expect(hiddenSvg).to.not.include("Flur");
	});

	it("normalizes writable live-map background colors", () => {
		expect(DEFAULT_LIVE_MAP_BACKGROUND_COLOR).to.equal("#b8ccd8");
		expect(DEFAULT_LIVE_MAP_CANVAS_BACKGROUND_COLOR).to.equal("#d9d9d9");
		expect(normalizeLiveMapBackgroundColor(" #DDEEFF ")).to.equal("#ddeeff");
		expect(normalizeLiveMapBackgroundColor("ddeeff")).to.equal(undefined);
		expect(normalizeLiveMapBackgroundColor("#ddeef")).to.equal(undefined);
		expect(normalizeLiveMapBackgroundColor("#ddeeff00")).to.equal(undefined);
	});

	it("animates the robot along the newest accepted path segment", () => {
		const width = 20;
		const height = 20;
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
			[{ pos: [250, 250] }, { pos: [750, 250], phi: 1_570 }],
		);

		const svg = decodeSvgDataUrl(image?.svgDataUrl);
		expect(svg).to.include("<animateMotion");
		expect(svg).to.include('dur="1600ms"');
		expect(svg).to.match(/path="M\d+ \d+(?: L\d+ \d+)+"/);
	});

	it("can render a stationary SVG marker for non-pose map refreshes", () => {
		const grid = Buffer.alloc(100, 127);
		const image = renderLiveMapImage20002(
			{
				map: encodeLiteralOnlyLz4(grid).toString("base64"),
				width: 10,
				height: 10,
				resolution: 0.05,
				x_min: 0,
				y_min: 0,
			},
			[{ pos: [100, 100] }, { pos: [300, 100] }],
			{ animateRobot: false },
		);

		const svg = decodeSvgDataUrl(image?.svgDataUrl);
		expect(svg).to.not.include("<animateMotion");
		expect(svg).to.match(/transform="translate\(\d+ \d+\)"/);
	});

	it("does not treat a spurious charging status as task completion while cleaning remains active", () => {
		const transition = transitionLiveMapTaskState(
			{ dockedSinceLastCleaning: false, returningToDock: false, cleaningTaskActive: true },
			"charge",
			true,
		);

		expect(transition).to.deep.equal({
			state: { dockedSinceLastCleaning: false, returningToDock: false, cleaningTaskActive: true },
			resetTrail: false,
			completedTask: false,
		});
	});

	it("resets the previous trail only after a confirmed return-to-dock cycle and a new sweep", () => {
		const returning = transitionLiveMapTaskState(
			{ dockedSinceLastCleaning: false, returningToDock: false, cleaningTaskActive: true },
			"backcharge",
			false,
		);
		const docked = transitionLiveMapTaskState(returning.state, "fullcharge", false);
		const nextSweep = transitionLiveMapTaskState(docked.state, "sweep", true);

		expect(returning.state.returningToDock).to.equal(true);
		expect(docked.state).to.deep.equal({
			dockedSinceLastCleaning: true,
			returningToDock: false,
			cleaningTaskActive: false,
		});
		expect(nextSweep).to.deep.equal({
			state: { dockedSinceLastCleaning: false, returningToDock: false, cleaningTaskActive: true },
			resetTrail: true,
			completedTask: false,
		});
		expect(docked.completedTask).to.equal(true);
	});

	it("keeps an active paused task intact even after the short cleaning-activity hold expires", () => {
		const transition = transitionLiveMapTaskState(
			{ dockedSinceLastCleaning: false, returningToDock: false, cleaningTaskActive: true },
			"fullcharge",
			false,
		);

		expect(transition).to.deep.equal({
			state: { dockedSinceLastCleaning: false, returningToDock: false, cleaningTaskActive: true },
			resetTrail: false,
			completedTask: false,
		});
	});

	it("recognizes an initial docked status before any cleaning task is active", () => {
		const transition = transitionLiveMapTaskState(
			{ dockedSinceLastCleaning: false, returningToDock: false, cleaningTaskActive: false },
			"charge",
			false,
		);

		expect(transition.state).to.deep.equal({
			dockedSinceLastCleaning: true,
			returningToDock: false,
			cleaningTaskActive: false,
		});
		expect(transition.completedTask).to.equal(false);
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

function decodeSvgDataUrl(dataUrl: string | undefined): string {
	expect(dataUrl).to.be.a("string");
	const encoded = dataUrl?.slice("data:image/svg+xml;base64,".length) ?? "";
	return Buffer.from(encoded, "base64").toString("utf8");
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

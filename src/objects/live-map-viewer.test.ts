import { expect } from "chai";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("live map web viewer", () => {
	const viewerRoot = join(process.cwd(), "www", "map-viewer");

	it("ships a same-origin ioBroker socket viewer with an embeddable viewport", () => {
		const html = readFileSync(join(viewerRoot, "index.html"), "utf8");
		const style = readFileSync(join(viewerRoot, "viewer.css"), "utf8");
		const script = readFileSync(join(viewerRoot, "viewer.js"), "utf8");

		expect(html).to.include('id="viewport"');
		expect(html).to.include('src="/lib/js/socket.io.js"');
		expect(html).to.include('href="./viewer.css?revision=20260921-3"');
		expect(html).to.include('src="./viewer.js?revision=20260921-3"');
		expect(script).to.include("proscenic.${instance}");
		expect(script).to.include("${rootPrefix}.map.live");
		expect(script).to.include(".svgDataUri");
		expect(script).to.include(".pngDataUri");
		expect(script).to.include(".canvasBackgroundColor");
		expect(script).to.include(".showZoneOverlays");
		expect(script).to.include(".commands.zones.selectedIds");
		expect(script).to.include(".commands.zones.start");
		expect(script).to.include('socketRequest("setState"');
		expect(script).to.include("zoneAtPointer");
		expect(script).to.include("withoutEmbeddedZoneLabels");
		expect(script).to.include("renderZoneLabels");
		expect(script).to.include('"▶ 1 Zone"');
		expect(script).to.include("new window.Image()");
		expect(html).to.include('id="mapStage"');
		expect(html).to.include('id="zoneStart"');
		expect(html).to.include('id="zoneLabels"');
		expect(html).to.not.include("<canvas");
		expect(html).to.not.include("viewer-header");
		expect(style).to.include("grid-template-rows: minmax(0, 1fr)");
		expect(style).to.include("min-height: 0");
		expect(style).to.include("#zoneStart");
		expect(script).to.include('document.createElement("span")');
		expect(script).to.include('label.className = "zone-label"');
		expect(script).to.include("area.center.x / image.naturalWidth");
		expect(script).to.include("label.style.left = `${(area.center.x / image.naturalWidth) * 100}%`");
		expect(script).to.include("label.style.top = `${(area.center.y / image.naturalHeight) * 100}%`");
		expect(script).to.include("zoneLabels.replaceChildren(fragment)");
		expect(script).to.include("zoneLabels.style.width = `${stageWidth}px`");
		expect(script).to.include("zoneLabels.style.height = `${stageHeight}px`");
		expect(style).to.include(".zone-label");
		expect(style).to.include("#zoneLabels");
		expect(style).to.include("width: 100%");
		expect(style).to.include("height: 100%");
		expect(script).to.include("currentSourcePriority");
		expect(script).to.include("id === preferredImageStateId ? 2 : 1");
		expect(style).to.include("border-radius: 999px");
		expect(script).to.not.match(/https?:\/\//u);
	});
});

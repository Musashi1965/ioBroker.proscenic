import { expect } from "chai";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("live map web viewer", () => {
	const viewerRoot = join(process.cwd(), "www", "map-viewer");

	it("ships a same-origin ioBroker socket viewer with an embeddable viewport", () => {
		const html = readFileSync(join(viewerRoot, "index.html"), "utf8");
		const script = readFileSync(join(viewerRoot, "viewer.js"), "utf8");

		expect(html).to.include('id="viewport"');
		expect(html).to.include('src="/lib/js/socket.io.js"');
		expect(script).to.include("proscenic.${instance}.map.live");
		expect(script).to.include(".svgDataUri");
		expect(script).to.include(".pngDataUri");
		expect(script).to.include(".canvasBackgroundColor");
		expect(script).to.include("new window.Image()");
		expect(html).to.not.include("viewer-header");
		expect(script).to.not.match(/https?:\/\//u);
	});
});

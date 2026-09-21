/* global document, window */

(() => {
	"use strict";

	const MAX_IMAGE_SOURCE_LENGTH = 512 * 1024;
	const MAX_ZONE_COUNT = 20;
	const POLL_INTERVAL_MS = 5000;
	const MAX_CANVAS_PIXEL_RATIO = 3;
	const ZONE_LABEL_FONT_SIZE = 9;
	const ZONE_LABEL_STROKE_WIDTH = 2;
	const params = new URLSearchParams(window.location.search);
	const requestedInstance = Number(params.get("instance"));
	const instance = Number.isSafeInteger(requestedInstance) && requestedInstance >= 0 ? requestedInstance : 0;
	const rootPrefix = `proscenic.${instance}`;
	const mapStatePrefix = `${rootPrefix}.map.live`;
	const preferredImageStateId = `${mapStatePrefix}.svgDataUri`;
	const fallbackImageStateId = `${mapStatePrefix}.pngDataUri`;
	const imageStateIds = [preferredImageStateId, fallbackImageStateId];
	const backgroundColorStateId = `${mapStatePrefix}.canvasBackgroundColor`;
	const areasStateId = `${mapStatePrefix}.areas`;
	const showZoneOverlaysStateId = `${mapStatePrefix}.showZoneOverlays`;
	const availableZonesStateId = `${rootPrefix}.commands.zones.available`;
	const selectedZonesStateId = `${rootPrefix}.commands.zones.selectedIds`;
	const startZoneCleaningStateId = `${rootPrefix}.commands.zones.start`;
	const zoneCleaningCapabilityStateId = `${rootPrefix}.capabilities.zoneCleaning`;
	const interactionStateIds = [
		areasStateId,
		showZoneOverlaysStateId,
		availableZonesStateId,
		selectedZonesStateId,
		zoneCleaningCapabilityStateId,
	];
	const subscribedStateIds = [...imageStateIds, backgroundColorStateId, ...interactionStateIds];
	const viewport = document.getElementById("viewport");
	const mapStage = document.getElementById("mapStage");
	const image = document.getElementById("mapImage");
	const zoneLabels = document.getElementById("zoneLabels");
	const empty = document.getElementById("empty");
	const zoneStart = document.getElementById("zoneStart");
	const interactionStatus = document.getElementById("interactionStatus");
	const view = { scale: 1, x: 0, y: 0 };
	let socket;
	let connected = false;
	let loading = false;
	let currentSource = "";
	let currentSourcePriority = 0;
	let currentMapWidth = 0;
	let currentMapHeight = 0;
	let pendingSource = "";
	let pendingSourcePriority = 0;
	let pointer;
	let suppressClickUntil = 0;
	let zoneAreas = [];
	let availableZoneIds = new Set();
	let selectedZoneIds = new Set();
	let showZoneOverlays = false;
	let zoneCleaningAvailable = false;
	let selectionWritePending = false;
	let startWritePending = false;
	let renderedZoneLabelsSignature;

	function socketRequest(event, ...args) {
		return new Promise((resolve, reject) => {
			if (!socket || !connected) {
				reject(new Error("ioBroker socket is not connected"));
				return;
			}
			socket.emit(event, ...args, (error, result) => {
				if (error) {
					reject(new Error(String(error)));
				} else {
					resolve(result);
				}
			});
		});
	}

	function safeImageSource(value) {
		const source = String(value ?? "").trim();
		if (!source || source.length > MAX_IMAGE_SOURCE_LENGTH) {
			return "";
		}
		if (/^data:image\/svg\+xml;base64,[a-z0-9+/]+=*$/iu.test(source)) {
			return source;
		}
		if (/^data:image\/png;base64,ivborw0kggo[a-z0-9+/]*={0,2}$/iu.test(source)) {
			return source;
		}
		return "";
	}

	function withoutEmbeddedZoneLabels(source) {
		const prefix = "data:image/svg+xml;base64,";
		if (!source.startsWith(prefix)) {
			return source;
		}
		try {
			const decoded = window.atob(source.slice(prefix.length));
			const stripped = decoded.replace(/<text\b[^>]*data-zone-label="true"[^>]*>[^<]*<\/text>/gu, "");
			return `${prefix}${window.btoa(stripped)}`;
		} catch {
			return source;
		}
	}

	function svgSourceDimensions(source) {
		const prefix = "data:image/svg+xml;base64,";
		if (!source.startsWith(prefix)) {
			return undefined;
		}
		try {
			const decoded = window.atob(source.slice(prefix.length));
			const match = decoded.match(/<svg\b[^>]*\bviewBox="0 0 ([0-9]+(?:\.[0-9]+)?) ([0-9]+(?:\.[0-9]+)?)"/u);
			if (!match) {
				return undefined;
			}
			const width = Number(match[1]);
			const height = Number(match[2]);
			return width > 0 && height > 0 && width <= 4096 && height <= 4096 ? { width, height } : undefined;
		} catch {
			return undefined;
		}
	}

	function stateValue(state) {
		if (state && typeof state === "object" && "val" in state) {
			return state.val;
		}
		return state;
	}

	function safeBoolean(value) {
		if (value === true || value === 1 || value === "1" || value === "true") {
			return true;
		}
		if (value === false || value === 0 || value === "0" || value === "false") {
			return false;
		}
		return undefined;
	}

	function safeJson(value) {
		if (typeof value !== "string" || value.length > 64 * 1024) {
			return undefined;
		}
		try {
			return JSON.parse(value);
		} catch {
			return undefined;
		}
	}

	function safeZoneIds(value) {
		const parsed = safeJson(value);
		if (!Array.isArray(parsed) || parsed.length > MAX_ZONE_COUNT) {
			return new Set();
		}
		const result = new Set();
		for (const id of parsed) {
			if (!Number.isSafeInteger(id) || id < 0) {
				return new Set();
			}
			result.add(id);
		}
		return result;
	}

	function safeAvailableZoneIds(value) {
		const parsed = safeJson(value);
		if (!Array.isArray(parsed) || parsed.length > MAX_ZONE_COUNT) {
			return new Set();
		}
		return new Set(
			parsed
				.map(entry => (entry && typeof entry === "object" ? entry.id : undefined))
				.filter(id => Number.isSafeInteger(id) && id >= 0),
		);
	}

	function safeZoneAreas(value) {
		const parsed = safeJson(value);
		if (!Array.isArray(parsed) || parsed.length > MAX_ZONE_COUNT * 2) {
			return [];
		}
		return parsed.flatMap(entry => {
			if (!entry || typeof entry !== "object" || entry.kind !== "zone" || !Number.isSafeInteger(entry.id)) {
				return [];
			}
			const bounds = entry.bounds;
			if (
				!bounds ||
				typeof bounds !== "object" ||
				![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite) ||
				bounds.minX > bounds.maxX ||
				bounds.minY > bounds.maxY
			) {
				return [];
			}
			const label =
				typeof entry.label === "string"
					? entry.label
							.trim()
							.replace(/[\p{Cc}\p{Cf}]/gu, " ")
							.slice(0, 128)
					: "";
			const center =
				entry.center &&
				typeof entry.center === "object" &&
				Number.isFinite(entry.center.x) &&
				Number.isFinite(entry.center.y)
					? entry.center
					: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
			return [{ id: entry.id, bounds, center, label }];
		});
	}

	function safeBackgroundColor(value) {
		const color = String(value ?? "")
			.trim()
			.toLowerCase();
		return /^#[0-9a-f]{6}$/u.test(color) ? color : "";
	}

	function applyBackgroundColor(value) {
		const color = safeBackgroundColor(value);
		if (color) {
			document.documentElement.style.setProperty("--viewer-background", color);
		}
	}

	async function readState(id) {
		if (connected) {
			return socketRequest("getState", id);
		}
		const response = await fetch(`/state/${encodeURIComponent(id)}`, { cache: "no-store" });
		if (!response.ok) {
			throw new Error(`State unavailable: ${id}`);
		}
		const text = await response.text();
		try {
			return JSON.parse(text);
		} catch {
			return { val: text };
		}
	}

	async function writeState(id, value) {
		await socketRequest("setState", id, { val: value, ack: false });
	}

	function setInteractionStatus(message, isError = false) {
		interactionStatus.textContent = message;
		interactionStatus.classList.toggle("is-error", isError);
	}

	function validSelectedZoneIds() {
		return [...selectedZoneIds].filter(id => availableZoneIds.has(id));
	}

	function updateInteractionUi() {
		const selectionEnabled = showZoneOverlays && zoneCleaningAvailable && zoneAreas.length > 0;
		const selected = validSelectedZoneIds();
		viewport.classList.toggle("is-zone-selection", selectionEnabled);
		zoneStart.hidden = !selectionEnabled || selected.length === 0;
		zoneStart.disabled = !connected || selectionWritePending || startWritePending;
		zoneStart.textContent = selected.length === 1 ? "▶ 1 Zone" : `▶ ${selected.length} Zonen`;
		renderZoneLabels();
	}

	function renderZoneLabels() {
		const stageWidth = mapStage.clientWidth;
		const stageHeight = mapStage.clientHeight;
		const sourceWidth = currentMapWidth;
		const sourceHeight = currentMapHeight;
		const visibleAreas = showZoneOverlays ? zoneAreas.filter(area => area.label) : [];
		const pixelRatio = Math.min(MAX_CANVAS_PIXEL_RATIO, Math.max(1, window.devicePixelRatio || 1));
		const signature = JSON.stringify({
			stageWidth,
			stageHeight,
			sourceWidth,
			sourceHeight,
			pixelRatio,
			scale: view.scale,
			areas: visibleAreas,
		});
		if (signature === renderedZoneLabelsSignature) {
			return;
		}
		renderedZoneLabelsSignature = signature;
		zoneLabels.width = Math.max(1, Math.round(stageWidth * pixelRatio));
		zoneLabels.height = Math.max(1, Math.round(stageHeight * pixelRatio));
		const context = zoneLabels.getContext("2d");
		if (!context || stageWidth <= 0 || stageHeight <= 0) {
			return;
		}
		context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
		context.clearRect(0, 0, stageWidth, stageHeight);
		if (!sourceWidth || !sourceHeight || visibleAreas.length === 0) {
			return;
		}
		const scaleX = stageWidth / sourceWidth;
		const scaleY = stageHeight / sourceHeight;
		context.fillStyle = "#263b4a";
		context.strokeStyle = "rgb(255 255 255 / 90%)";
		context.lineJoin = "round";
		context.lineWidth = ZONE_LABEL_STROKE_WIDTH / view.scale;
		context.font = `600 ${ZONE_LABEL_FONT_SIZE / view.scale}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
		context.textAlign = "center";
		context.textBaseline = "middle";
		for (const area of visibleAreas) {
			const x = area.center.x * scaleX;
			const y = area.center.y * scaleY;
			context.strokeText(area.label, x, y);
			context.fillText(area.label, x, y);
		}
	}

	function fitMapStage() {
		if (!currentMapWidth || !currentMapHeight) {
			return;
		}
		const availableWidth = Math.max(1, viewport.clientWidth - 24);
		const availableHeight = Math.max(1, viewport.clientHeight - 24);
		const ratio = Math.min(availableWidth / currentMapWidth, availableHeight / currentMapHeight);
		const stageWidth = Math.max(1, Math.floor(currentMapWidth * ratio));
		const stageHeight = Math.max(1, Math.floor(currentMapHeight * ratio));
		mapStage.style.width = `${stageWidth}px`;
		mapStage.style.height = `${stageHeight}px`;
		renderZoneLabels();
	}

	function setSource(source, priority) {
		if (!source || source === currentSource || source === pendingSource) {
			return;
		}
		if (priority < currentSourcePriority || priority < pendingSourcePriority) {
			return;
		}
		pendingSource = source;
		pendingSourcePriority = priority;
		const displaySource = withoutEmbeddedZoneLabels(source);
		const declaredDimensions = svgSourceDimensions(source);
		const preload = new window.Image();
		preload.decoding = "async";
		preload.addEventListener(
			"load",
			async () => {
				try {
					await preload.decode?.();
				} catch {
					// The load event already proves that the browser can display this source.
				}
				if (pendingSource !== source || pendingSourcePriority !== priority) {
					return;
				}
				currentMapWidth = declaredDimensions?.width ?? preload.naturalWidth;
				currentMapHeight = declaredDimensions?.height ?? preload.naturalHeight;
				image.src = displaySource;
				currentSource = source;
				currentSourcePriority = priority;
				pendingSource = "";
				pendingSourcePriority = 0;
			},
			{ once: true },
		);
		preload.addEventListener(
			"error",
			() => {
				if (pendingSource !== source || pendingSourcePriority !== priority) {
					return;
				}
				pendingSource = "";
				pendingSourcePriority = 0;
				if (!currentSource) {
					empty.textContent = "The live map image could not be displayed.";
					empty.hidden = false;
				}
			},
			{ once: true },
		);
		preload.src = displaySource;
	}

	async function refreshInteraction() {
		const [areas, overlays, available, selected, capability] = await Promise.all(
			interactionStateIds.map(id => readState(id)),
		);
		zoneAreas = safeZoneAreas(stateValue(areas));
		showZoneOverlays = safeBoolean(stateValue(overlays)) === true;
		availableZoneIds = safeAvailableZoneIds(stateValue(available));
		selectedZoneIds = safeZoneIds(stateValue(selected));
		zoneCleaningAvailable = safeBoolean(stateValue(capability)) === true;
		updateInteractionUi();
	}

	async function refreshMap() {
		if (loading) {
			return;
		}
		loading = true;
		try {
			applyBackgroundColor(stateValue(await readState(backgroundColorStateId)));
			await refreshInteraction();
			for (const [index, id] of imageStateIds.entries()) {
				const source = safeImageSource(stateValue(await readState(id)));
				if (source) {
					setSource(source, imageStateIds.length - index);
					return;
				}
			}
			empty.textContent = "Waiting for map data…";
			empty.hidden = false;
		} catch {
			if (!currentSource) {
				empty.textContent = "Live map is currently unavailable.";
				empty.hidden = false;
			}
		} finally {
			loading = false;
		}
	}

	function applyTransform() {
		mapStage.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`;
		renderZoneLabels();
	}

	function zoom(factor) {
		view.scale = Math.min(6, Math.max(1, view.scale * factor));
		if (view.scale === 1) {
			view.x = 0;
			view.y = 0;
		}
		applyTransform();
	}

	function resetView() {
		view.scale = 1;
		view.x = 0;
		view.y = 0;
		applyTransform();
	}

	function zoneAtPointer(event) {
		if (!currentMapWidth || !currentMapHeight) {
			return undefined;
		}
		const rect = mapStage.getBoundingClientRect();
		if (
			rect.width <= 0 ||
			rect.height <= 0 ||
			event.clientX < rect.left ||
			event.clientX > rect.right ||
			event.clientY < rect.top ||
			event.clientY > rect.bottom
		) {
			return undefined;
		}
		const x = ((event.clientX - rect.left) / rect.width) * currentMapWidth;
		const y = ((event.clientY - rect.top) / rect.height) * currentMapHeight;
		return zoneAreas
			.filter(
				area =>
					availableZoneIds.has(area.id) &&
					x >= area.bounds.minX &&
					x <= area.bounds.maxX &&
					y >= area.bounds.minY &&
					y <= area.bounds.maxY,
			)
			.sort(
				(left, right) =>
					(left.bounds.maxX - left.bounds.minX) * (left.bounds.maxY - left.bounds.minY) -
					(right.bounds.maxX - right.bounds.minX) * (right.bounds.maxY - right.bounds.minY),
			)[0];
	}

	async function toggleZone(zoneId) {
		if (selectionWritePending) {
			return;
		}
		const next = new Set(validSelectedZoneIds());
		if (next.has(zoneId)) {
			next.delete(zoneId);
		} else {
			next.add(zoneId);
		}
		selectionWritePending = true;
		selectedZoneIds = next;
		updateInteractionUi();
		try {
			await writeState(selectedZonesStateId, JSON.stringify([...next]));
			setInteractionStatus(next.size === 0 ? "Keine Zone ausgewählt" : "Zonenauswahl übernommen");
		} catch {
			setInteractionStatus("Zonenauswahl konnte nicht gespeichert werden", true);
			await refreshInteraction().catch(() => undefined);
		} finally {
			selectionWritePending = false;
			updateInteractionUi();
		}
	}

	image.addEventListener("load", () => {
		mapStage.classList.add("is-visible");
		fitMapStage();
		renderZoneLabels();
		empty.hidden = true;
	});
	image.addEventListener("error", () => {
		currentSource = "";
		currentSourcePriority = 0;
		currentMapWidth = 0;
		currentMapHeight = 0;
		mapStage.classList.remove("is-visible");
		empty.textContent = "The live map image could not be displayed.";
		empty.hidden = false;
	});

	viewport.addEventListener(
		"wheel",
		event => {
			if (!event.ctrlKey && !event.metaKey) {
				return;
			}
			event.preventDefault();
			zoom(event.deltaY < 0 ? 1.18 : 1 / 1.18);
		},
		{ passive: false },
	);
	viewport.addEventListener("dblclick", resetView);
	viewport.addEventListener("pointerdown", event => {
		if (event.target.closest("button") || view.scale <= 1) {
			return;
		}
		pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
		viewport.setPointerCapture(event.pointerId);
		viewport.classList.add("is-dragging");
	});
	viewport.addEventListener("pointermove", event => {
		if (!pointer || pointer.id !== event.pointerId) {
			return;
		}
		const deltaX = event.clientX - pointer.x;
		const deltaY = event.clientY - pointer.y;
		if (Math.abs(deltaX) + Math.abs(deltaY) > 2) {
			pointer.moved = true;
		}
		view.x += deltaX;
		view.y += deltaY;
		pointer.x = event.clientX;
		pointer.y = event.clientY;
		applyTransform();
	});
	const stopDragging = event => {
		if (!pointer || pointer.id !== event.pointerId) {
			return;
		}
		if (pointer.moved) {
			suppressClickUntil = Date.now() + 250;
		}
		pointer = undefined;
		viewport.classList.remove("is-dragging");
	};
	viewport.addEventListener("pointerup", stopDragging);
	viewport.addEventListener("pointercancel", stopDragging);
	viewport.addEventListener("click", event => {
		if (
			Date.now() < suppressClickUntil ||
			event.target.closest("button") ||
			!showZoneOverlays ||
			!zoneCleaningAvailable
		) {
			return;
		}
		const zone = zoneAtPointer(event);
		if (zone) {
			void toggleZone(zone.id);
		}
	});

	zoneStart.addEventListener("click", async () => {
		if (startWritePending || validSelectedZoneIds().length === 0) {
			return;
		}
		startWritePending = true;
		updateInteractionUi();
		try {
			await writeState(startZoneCleaningStateId, true);
			setInteractionStatus("Zonenreinigung wurde angefordert");
		} catch {
			setInteractionStatus("Zonenreinigung konnte nicht gestartet werden", true);
		} finally {
			window.setTimeout(() => {
				startWritePending = false;
				updateInteractionUi();
			}, 1200);
		}
	});

	document.querySelector('[data-zoom="in"]').addEventListener("click", () => zoom(1.25));
	document.querySelector('[data-zoom="out"]').addEventListener("click", () => zoom(0.8));
	document.querySelector('[data-zoom="reset"]').addEventListener("click", resetView);

	try {
		socket = window.io({ path: "/socket.io/" });
		socket.on("connect", async () => {
			connected = true;
			socket.emit("subscribe", subscribedStateIds);
			await refreshMap();
		});
		socket.on("disconnect", () => {
			connected = false;
			updateInteractionUi();
		});
		socket.on("connect_error", () => {
			connected = false;
			updateInteractionUi();
		});
		socket.on("stateChange", (id, state) => {
			if (id === backgroundColorStateId) {
				applyBackgroundColor(stateValue(state));
				return;
			}
			if (id === areasStateId) {
				zoneAreas = safeZoneAreas(stateValue(state));
				updateInteractionUi();
				return;
			}
			if (id === showZoneOverlaysStateId) {
				showZoneOverlays = safeBoolean(stateValue(state)) === true;
				updateInteractionUi();
				return;
			}
			if (id === availableZonesStateId) {
				availableZoneIds = safeAvailableZoneIds(stateValue(state));
				updateInteractionUi();
				return;
			}
			if (id === selectedZonesStateId) {
				selectedZoneIds = safeZoneIds(stateValue(state));
				updateInteractionUi();
				return;
			}
			if (id === zoneCleaningCapabilityStateId) {
				zoneCleaningAvailable = safeBoolean(stateValue(state)) === true;
				updateInteractionUi();
				return;
			}
			if (!imageStateIds.includes(id)) {
				return;
			}
			const source = safeImageSource(stateValue(state));
			if (source) {
				setSource(source, id === preferredImageStateId ? 2 : 1);
			}
		});
	} catch {
		// The polling fallback below remains available for read-only map display.
	}

	if (typeof window.ResizeObserver === "function") {
		const resizeObserver = new window.ResizeObserver(entries => {
			if (entries.some(entry => entry.target === viewport)) {
				fitMapStage();
			}
		});
		resizeObserver.observe(viewport);
	} else {
		window.addEventListener("resize", fitMapStage);
	}
	window.setInterval(refreshMap, POLL_INTERVAL_MS);
	void refreshMap();
})();

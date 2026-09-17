/* global document, window */

(() => {
	"use strict";

	const MAX_IMAGE_SOURCE_LENGTH = 512 * 1024;
	const POLL_INTERVAL_MS = 5000;
	const params = new URLSearchParams(window.location.search);
	const requestedInstance = Number(params.get("instance"));
	const instance = Number.isSafeInteger(requestedInstance) && requestedInstance >= 0 ? requestedInstance : 0;
	const statePrefix = `proscenic.${instance}.map.live`;
	const imageStateIds = [`${statePrefix}.svgDataUri`, `${statePrefix}.pngDataUri`];
	const viewport = document.getElementById("viewport");
	const image = document.getElementById("mapImage");
	const empty = document.getElementById("empty");
	const connectionStatus = document.getElementById("connectionStatus");
	const view = { scale: 1, x: 0, y: 0 };
	let socket;
	let connected = false;
	let loading = false;
	let currentSource = "";
	let pendingSource = "";
	let pointer;

	if (params.get("embed") === "1") {
		document.body.classList.add("is-embedded");
	}

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

	function stateValue(state) {
		if (state && typeof state === "object" && "val" in state) {
			return state.val;
		}
		return state;
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

	function setSource(source) {
		if (!source || source === currentSource || source === pendingSource) {
			return;
		}
		pendingSource = source;
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
				if (pendingSource !== source) {
					return;
				}
				image.src = source;
				currentSource = source;
				pendingSource = "";
			},
			{ once: true },
		);
		preload.addEventListener(
			"error",
			() => {
				if (pendingSource !== source) {
					return;
				}
				pendingSource = "";
				if (!currentSource) {
					empty.textContent = "The live map image could not be displayed.";
					empty.hidden = false;
				}
			},
			{ once: true },
		);
		preload.src = source;
	}

	async function refreshMap() {
		if (loading) {
			return;
		}
		loading = true;
		try {
			for (const id of imageStateIds) {
				const source = safeImageSource(stateValue(await readState(id)));
				if (source) {
					setSource(source);
					connectionStatus.textContent = connected ? "Live" : "Polling";
					return;
				}
			}
			empty.textContent = "Waiting for map data…";
			empty.hidden = false;
		} catch {
			connectionStatus.textContent = "Disconnected";
			if (!currentSource) {
				empty.textContent = "Live map is currently unavailable.";
				empty.hidden = false;
			}
		} finally {
			loading = false;
		}
	}

	function applyTransform() {
		image.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`;
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

	image.addEventListener("load", () => {
		image.classList.add("is-visible");
		empty.hidden = true;
	});
	image.addEventListener("error", () => {
		currentSource = "";
		image.classList.remove("is-visible");
		empty.textContent = "The live map image could not be displayed.";
		empty.hidden = false;
	});

	viewport.addEventListener(
		"wheel",
		event => {
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
		pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
		viewport.setPointerCapture(event.pointerId);
		viewport.classList.add("is-dragging");
	});
	viewport.addEventListener("pointermove", event => {
		if (!pointer || pointer.id !== event.pointerId) {
			return;
		}
		view.x += event.clientX - pointer.x;
		view.y += event.clientY - pointer.y;
		pointer.x = event.clientX;
		pointer.y = event.clientY;
		applyTransform();
	});
	const stopDragging = event => {
		if (!pointer || pointer.id !== event.pointerId) {
			return;
		}
		pointer = undefined;
		viewport.classList.remove("is-dragging");
	};
	viewport.addEventListener("pointerup", stopDragging);
	viewport.addEventListener("pointercancel", stopDragging);

	document.querySelector('[data-zoom="in"]').addEventListener("click", () => zoom(1.25));
	document.querySelector('[data-zoom="out"]').addEventListener("click", () => zoom(0.8));
	document.querySelector('[data-zoom="reset"]').addEventListener("click", resetView);

	try {
		socket = window.io({ path: "/socket.io/" });
		socket.on("connect", async () => {
			connected = true;
			connectionStatus.textContent = "Connected";
			socket.emit("subscribe", imageStateIds);
			await refreshMap();
		});
		socket.on("disconnect", () => {
			connected = false;
			connectionStatus.textContent = "Disconnected";
		});
		socket.on("connect_error", () => {
			connected = false;
			connectionStatus.textContent = "Polling";
		});
		socket.on("stateChange", (id, state) => {
			if (!imageStateIds.includes(id)) {
				return;
			}
			const source = safeImageSource(stateValue(state));
			if (source) {
				setSource(source);
			}
		});
	} catch {
		connectionStatus.textContent = "Polling";
	}

	window.setInterval(refreshMap, POLL_INTERVAL_MS);
	void refreshMap();
})();

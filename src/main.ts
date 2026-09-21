/*
 * Created with @iobroker/create-adapter v3.1.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from "@iobroker/adapter-core";
import {
	buildConsumableResetRequest,
	consumableResetForStateId,
	normalizeConsumableCounterSnapshot,
	normalizeConsumables21015,
	runSafeConsumableReset,
	type ConsumableComponent,
	type ConsumableCounterSnapshot,
} from "./domain/consumables";
import {
	buildCommandRequest,
	commandForStateId,
	isStatusConfirmationForCommand,
	normalizeCommandButtonValue,
	supportsStatusConfirmation,
	type ConfirmableRobotCommand,
	type RobotCommand,
} from "./domain/commands";
import {
	DEFAULT_LIVE_MAP_BACKGROUND_COLOR,
	DEFAULT_LIVE_MAP_CANVAS_BACKGROUND_COLOR,
	extractLiveMapCoordinateMetadata20002,
	extractLiveMapZoneCatalog21004,
	extractRobotPose20001,
	mergeLiveMapCoordinateMetadataCache,
	mergeLiveMapCoordinateMetadata20002,
	normalizeLiveMapBackgroundColor,
	replaceLiveMapZoneCatalog,
	renderLiveMapImage20002,
	transitionLiveMapTaskState,
	type LiveMapCoordinateMetadata,
	type RobotPose,
} from "./domain/live-map";
import { normalizeMaintenanceHistory20003, normalizeMaintenanceMessage20003 } from "./domain/maintenance-message";
import { normalizeMap20002 } from "./domain/map";
import { reconnectDelayMs } from "./domain/reconnect-policy";
import {
	CLEANING_ACTIVITY_HOLD_MS,
	deriveRobotActivity,
	hasCleaningProgress,
	normalizeStatus20001,
	type RobotStatus,
} from "./domain/status";
import {
	buildZoneCleaningRequest,
	normalizeZoneSelection,
	shouldRecoverPendingZoneCleaningSelection,
	validateZoneCleaningSelection,
	zoneCleaningOptions,
} from "./domain/zone-cleaning";
import { extendAdapterObjects } from "./objects/object-definitions";
import {
	projectDevice,
	projectConsumableResetProgress,
	projectConsumables,
	projectLiveMapImage,
	projectLiveMapViewerUrl,
	projectMapZoneCatalogReadSuccess,
	projectMapMetadata,
	projectMaintenanceHistory,
	projectMaintenanceMessage,
	projectRobotActivity,
	projectStatus,
	projectZoneCleaningCatalog,
	redactedErrorMessage,
	setConsumablesReadFailure,
	setConsumableResetCapability,
	setConsumableResetFailure,
	setConnectionState,
	setDeviceListDiagnostics,
	setDeviceOnlineStale,
	setInitialCapabilityStates,
	setLastError,
	setMaintenanceHistoryReadFailure,
	setMapZoneCatalogReadFailure,
	initializeLiveMapAreaStates,
} from "./objects/projector";
import { ProscenicGatewayClient } from "./protocol/gateway-client";
import { ProscenicRestClient } from "./protocol/rest-client";
import type { DeviceRecord, GatewayData, GatewayEndpoint } from "./protocol/types";

const DEFAULT_TIMEOUT_MS = 10_000;
const CONSUMABLE_GATEWAY_TIMEOUT_MS = 35_000;
const MAP_ZONE_CATALOG_TIMEOUT_MS = 35_000;
const MAP_ZONE_CATALOG_RETRY_INTERVAL_MS = 60_000;
const AUXILIARY_READ_INTERVAL_MS = 15 * 60_000;
const GATEWAY_IDLE_TIMEOUT_MS = 90_000;
const GATEWAY_IDLE_CHECK_INTERVAL_MS = 30_000;
const GATEWAY_STABLE_CONNECTION_MS = 5 * 60_000;
const GATEWAY_SOCKET_RECONNECT_DELAY_MS = 5_000;
const COMMAND_SESSION_WAIT_MS = 15_000;
const COMMAND_CONFIRMATION_TIMEOUT_MS = 20_000;
const COMMAND_SESSION_POLL_MS = 250;
const MAX_QUEUED_COMMANDS = 5;
const MAX_GATEWAY_BUFFER_BYTES = 512 * 1024;
const MAX_LIVE_MAP_POSES = 1_000;

interface PendingConsumableEvent {
	expectedInfoType: 21015 | 21016;
	timer: ioBroker.Timeout;
	resolve: (snapshot: ConsumableCounterSnapshot) => void;
	reject: (error: Error) => void;
}

interface PendingMapZoneCatalogRead {
	promise: Promise<LiveMapCoordinateMetadata>;
	timer: ioBroker.Timeout;
	resolve: (catalog: LiveMapCoordinateMetadata) => void;
	reject: (error: Error) => void;
}

interface CommandSession {
	client: ProscenicRestClient;
	token: string;
	serial: string;
	username: string;
}

interface PendingCommandConfirmation {
	command: ConfirmableRobotCommand;
	acceptedAt: number;
	timer: ioBroker.Timeout | undefined;
	resolve: (latencyMs: number | undefined) => void;
}

class Proscenic extends utils.Adapter {
	private gatewayClient: ProscenicGatewayClient | undefined;
	private reconnectTimer: ioBroker.Timeout | undefined;
	private gatewayIdleTimer: ReturnType<ioBroker.Adapter["setInterval"]> | undefined;
	private reconnectAttempt = 0;
	private reconnectInProgress = false;
	private commandExecutionChain: Promise<void> = Promise.resolve();
	private consumableOperationChain: Promise<void> = Promise.resolve();
	private queuedCommandCount = 0;
	private pendingCommandConfirmation: PendingCommandConfirmation | undefined;
	private commandEnabled = false;
	private commandClient: ProscenicRestClient | undefined;
	private commandToken: string | undefined;
	private commandSerial: string | undefined;
	private commandGatewayEndpoint: GatewayEndpoint | undefined;
	private shuttingDown = false;
	private recentRobotPoses: RobotPose[] = [];
	private latestMapData: unknown;
	private latestMapPathId: number | undefined;
	private latestMapId: number | undefined;
	private latestMapCoordinateMetadata: LiveMapCoordinateMetadata | undefined;
	private liveMapPathResetCount = 0;
	private liveMapDockedSinceLastCleaning = false;
	private liveMapReturningToDock = false;
	private liveMapCleaningTaskActive = false;
	private lastPoseUpdated: string | undefined;
	private maintenanceEventCount = 0;
	private auxiliaryReadInProgress = false;
	private lastAuxiliaryReadAt = 0;
	private gatewayConnectedAt = 0;
	private lastGatewayActivityAt = 0;
	private gatewayReceivedEventSinceConnect = false;
	private gatewayIdleReconnectCount = 0;
	private cloudConnected = false;
	private gatewayConnected = false;
	private latestRobotStatus: RobotStatus | undefined;
	private cleaningInferredUntilMs = 0;
	private pendingConsumableEvent: PendingConsumableEvent | undefined;
	private pendingMapZoneCatalogRead: PendingMapZoneCatalogRead | undefined;
	private latestMapZoneCatalogCount = 0;
	private hasLoadedMapZoneCatalog = false;
	private lastMapZoneCatalogRequestAt = 0;
	private liveMapCanvasBackgroundColor = DEFAULT_LIVE_MAP_CANVAS_BACKGROUND_COLOR;
	private liveMapMapBackgroundColor = DEFAULT_LIVE_MAP_BACKGROUND_COLOR;
	private liveMapShowZoneOverlays = true;
	private selectedZoneIds: number[] = [];
	private zoneCleaningCompletionPending = false;
	private zoneCleaningActivityObserved = false;
	private zoneCleaningPaused = false;
	private zoneCleaningCompletionTimer: ioBroker.Timeout | undefined;

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: "proscenic",
		});
		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		// this.on("objectChange", this.onObjectChange.bind(this));
		// this.on("message", this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	private async onReady(): Promise<void> {
		await extendAdapterObjects(this);
		await this.setState("info.connection", false, true);
		await this.setCloudConnection(false);
		await this.setGatewayConnection(false);
		await this.setStateAsync("device.onlineUpdated", { val: "", ack: true });
		await setDeviceOnlineStale(this, true);
		await setDeviceListDiagnostics(this, 0, "pending");
		await this.setStateAsync("connection.lastGatewayEvent", { val: "", ack: true });
		await this.setStateAsync("connection.gatewayIdleReconnectCount", { val: 0, ack: true });
		await this.setStateAsync("commands.queueDepth", { val: 0, ack: true });
		await setInitialCapabilityStates(this);
		await initializeLiveMapAreaStates(this);
		await projectLiveMapViewerUrl(this);
		await this.initializeLiveMapColors();
		await this.initializeZoneCleaningControls();
		this.subscribeStates("commands.*");
		this.subscribeStates("consumables.*.reset");
		this.subscribeStates("map.live.backgroundColor");
		this.subscribeStates("map.live.canvasBackgroundColor");
		this.subscribeStates("map.live.mapBackgroundColor");
		this.subscribeStates("map.live.showZoneOverlays");

		if (!this.config.username || !this.config.password) {
			await setDeviceListDiagnostics(this, 0, "not-configured");
			this.log.warn("Proscenic cloud credentials are not configured yet.");
			return;
		}

		await this.connectReadOnlyGateway();
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 *
	 * @param callback - Callback function
	 */
	private onUnload(callback: () => void): void {
		try {
			this.shuttingDown = true;
			this.clearReconnectTimer();
			this.clearGatewayIdleTimer();
			this.clearZoneCleaningCompletionTimer();
			this.rejectPendingConsumableEvent(new Error("Adapter unload interrupted consumable operation"));
			this.rejectPendingMapZoneCatalogRead(new Error("Adapter unload interrupted map zone catalog read"));
			this.cancelPendingCommandConfirmation();
			this.gatewayClient?.destroy();
			this.gatewayClient = undefined;
			this.clearCommandSession();
			callback();
		} catch (error) {
			this.log.error(`Error during unloading: ${(error as Error).message}`);
			callback();
		}
	}

	private async connectReadOnlyGateway(): Promise<void> {
		if (this.shuttingDown || this.reconnectInProgress) {
			return;
		}

		this.clearReconnectTimer();
		this.reconnectInProgress = true;
		try {
			await this.startReadOnlyGateway();
		} catch (error) {
			this.clearCommandSession();
			await setLastError(this, error);
			await setDeviceOnlineStale(this, true);
			await this.setCloudConnection(false);
			await this.setGatewayConnection(false);
			this.log.warn(`Could not start Proscenic read-only connection: ${redactedErrorMessage(error)}`);
			this.scheduleFullReconnect("connection failure");
		} finally {
			this.reconnectInProgress = false;
		}
	}

	private async startReadOnlyGateway(): Promise<void> {
		const client = new ProscenicRestClient({
			username: this.config.username,
			password: this.config.password,
			region: this.config.region,
			timeoutMs: DEFAULT_TIMEOUT_MS,
		});

		this.log.info("Connecting to the Proscenic legacy cloud.");
		const token = await client.login();
		this.commandEnabled = false;
		this.commandClient = client;
		this.commandToken = token;

		let devices: DeviceRecord[];
		try {
			devices = await client.listDevices();
		} catch (error) {
			await setDeviceListDiagnostics(this, 0, "failed");
			throw error;
		}
		await setDeviceListDiagnostics(this, devices.length, devices.length === 0 ? "empty" : "ok");
		const device = selectDevice(devices, this.config.deviceCode);
		await projectDevice(this, device);
		await this.setCloudConnection(true);

		if (!device.sn) {
			throw new Error("Selected device cannot be used because its protocol serial is missing");
		}
		this.commandSerial = device.sn;
		this.commandEnabled = isM7Pro(device);
		await this.setStateAsync("capabilities.commands", { val: this.commandEnabled, ack: true });
		const zoneOptions = zoneCleaningOptions(this.latestMapCoordinateMetadata);
		await projectZoneCleaningCatalog(
			this,
			zoneOptions,
			this.commandEnabled &&
				zoneOptions.length > 0 &&
				this.latestMapId !== undefined &&
				this.latestMapCoordinateMetadata?.mapId === this.latestMapId,
		);

		const gateway = await client.getGateway(token, device.sn);
		const endpoint = selectGatewayEndpoint(gateway);
		this.commandGatewayEndpoint = endpoint;
		this.reconnectAttempt = 0;

		this.connectGatewaySocket(endpoint, token, device.sn);
	}

	private connectGatewaySocket(endpoint: GatewayEndpoint, token: string, serial: string): void {
		this.gatewayClient?.destroy();
		this.clearGatewayIdleTimer();
		this.gatewayReceivedEventSinceConnect = false;
		this.gatewayClient = new ProscenicGatewayClient({
			endpoint,
			token,
			serial,
			timeoutMs: DEFAULT_TIMEOUT_MS,
			maxBufferBytes: MAX_GATEWAY_BUFFER_BYTES,
			onConnect: () => {
				const now = Date.now();
				this.gatewayConnectedAt = now;
				this.lastGatewayActivityAt = now;
				void this.setGatewayConnection(true);
				this.log.info("Connected to the Proscenic gateway.");
				this.scheduleGatewayIdleCheck();
				void this.refreshVerifiedReadPathsIfDue();
			},
			onEvent: event => {
				this.gatewayReceivedEventSinceConnect = true;
				this.recordGatewayEventActivity();
				void this.handleGatewayEvent(event.infoType, event.data);
			},
			onClose: () => {
				this.clearGatewayIdleTimer();
				void this.setGatewayConnection(false);
				this.rejectPendingConsumableEvent(new Error("Gateway closed before consumable data was received"));
				this.rejectPendingMapZoneCatalogRead(new Error("Gateway closed before map zones were received"));
				if (!this.shuttingDown) {
					this.resetReconnectAttemptAfterStableConnection();
					this.log.warn("Proscenic gateway connection closed.");
					this.scheduleGatewaySocketReconnect("gateway close");
				}
			},
			onError: error => {
				void setLastError(this, error);
				if (!this.shuttingDown) {
					this.log.warn(`Proscenic gateway error: ${redactedErrorMessage(error)}`);
				}
			},
		});
		this.gatewayClient.connect();
	}

	private scheduleFullReconnect(reason: string): void {
		if (this.shuttingDown || this.reconnectTimer) {
			return;
		}

		this.reconnectAttempt += 1;
		const delayMs = reconnectDelayMs(this.reconnectAttempt);
		this.log.info(
			`Scheduling full Proscenic cloud reconnect in ${Math.round(delayMs / 1_000)} seconds after ${reason}.`,
		);
		this.reconnectTimer = this.setTimeout(() => {
			this.reconnectTimer = undefined;
			void this.connectReadOnlyGateway();
		}, delayMs);
	}

	private scheduleGatewaySocketReconnect(reason: string): void {
		if (this.shuttingDown || this.reconnectTimer) {
			return;
		}

		if (!this.commandGatewayEndpoint || !this.commandToken || !this.commandSerial) {
			this.clearCommandSession();
			this.scheduleFullReconnect(`${reason}; missing gateway session material`);
			return;
		}

		if (!this.gatewayReceivedEventSinceConnect) {
			this.clearCommandSession();
			this.scheduleFullReconnect(`${reason}; gateway closed before any event`);
			return;
		}

		const delaySeconds = Math.round(GATEWAY_SOCKET_RECONNECT_DELAY_MS / 1_000);
		this.log.info(`Scheduling Proscenic gateway socket reconnect in ${delaySeconds} seconds after ${reason}.`);
		this.reconnectTimer = this.setTimeout(() => {
			this.reconnectTimer = undefined;
			if (!this.commandGatewayEndpoint || !this.commandToken || !this.commandSerial) {
				this.clearCommandSession();
				void this.connectReadOnlyGateway();
				return;
			}
			this.connectGatewaySocket(this.commandGatewayEndpoint, this.commandToken, this.commandSerial);
		}, GATEWAY_SOCKET_RECONNECT_DELAY_MS);
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer) {
			this.clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
	}

	private scheduleGatewayIdleCheck(): void {
		this.clearGatewayIdleTimer();
		this.gatewayIdleTimer = this.setInterval(() => {
			void this.checkGatewayIdle();
		}, GATEWAY_IDLE_CHECK_INTERVAL_MS);
	}

	private clearGatewayIdleTimer(): void {
		if (this.gatewayIdleTimer) {
			this.clearInterval(this.gatewayIdleTimer);
			this.gatewayIdleTimer = undefined;
		}
	}

	private recordGatewayEventActivity(): void {
		this.lastGatewayActivityAt = Date.now();
		void this.setStateAsync("connection.lastGatewayEvent", { val: new Date().toISOString(), ack: true });
	}

	private async checkGatewayIdle(): Promise<void> {
		if (this.shuttingDown || !this.gatewayClient || this.lastGatewayActivityAt === 0) {
			return;
		}

		const idleMs = Date.now() - this.lastGatewayActivityAt;
		if (idleMs <= GATEWAY_IDLE_TIMEOUT_MS) {
			return;
		}

		await this.reconnectIdleGateway(`no gateway event received for ${Math.round(idleMs / 1_000)} seconds`);
	}

	private async reconnectIdleGateway(reason: string): Promise<void> {
		if (this.shuttingDown || !this.gatewayClient) {
			return;
		}

		this.gatewayIdleReconnectCount += 1;
		this.log.warn(`Reconnecting stale Proscenic gateway: ${reason}.`);
		await this.setStateAsync("connection.gatewayIdleReconnectCount", {
			val: this.gatewayIdleReconnectCount,
			ack: true,
		});
		await setLastError(this, new Error(`Gateway idle watchdog: ${reason}`));
		await this.setGatewayConnection(false);
		this.rejectPendingConsumableEvent(new Error(`Gateway idle watchdog: ${reason}`));
		this.rejectPendingMapZoneCatalogRead(new Error(`Gateway idle watchdog: ${reason}`));
		this.clearGatewayIdleTimer();
		this.gatewayClient.destroy();
		this.gatewayClient = undefined;
		this.scheduleGatewaySocketReconnect("gateway idle watchdog");
	}

	private async setCloudConnection(connected: boolean): Promise<void> {
		this.cloudConnected = connected;
		await setConnectionState(this, "cloud", connected);
		await this.projectDerivedRobotActivity();
	}

	private async setGatewayConnection(connected: boolean): Promise<void> {
		this.gatewayConnected = connected;
		await setConnectionState(this, "gateway", connected);
		await this.projectDerivedRobotActivity();
	}

	private async projectDerivedRobotActivity(previousStatus?: RobotStatus): Promise<void> {
		const activity = deriveRobotActivity({
			cloudConnected: this.cloudConnected,
			gatewayConnected: this.gatewayConnected,
			status: this.latestRobotStatus,
			previousStatus,
			cleaningInferredUntilMs: this.cleaningInferredUntilMs,
		});
		await projectRobotActivity(this, activity);
	}

	private resetReconnectAttemptAfterStableConnection(): void {
		if (this.gatewayConnectedAt === 0) {
			return;
		}
		if (Date.now() - this.gatewayConnectedAt >= GATEWAY_STABLE_CONNECTION_MS) {
			this.reconnectAttempt = 0;
		}
	}

	private async handleGatewayEvent(infoType: unknown, data: unknown): Promise<void> {
		if (infoType === 21015 || infoType === 21016) {
			const snapshot = normalizeConsumableCounterSnapshot(data);
			const consumables = normalizeConsumables21015(data);
			if (consumables) {
				await projectConsumables(this, consumables);
			}
			if (snapshot) {
				if (infoType === 21015 && this.commandEnabled) {
					await setConsumableResetCapability(this, true);
				}
				this.resolvePendingConsumableEvent(infoType, snapshot);
			}
			return;
		}

		if (infoType === 21004) {
			const catalog = extractLiveMapZoneCatalog21004(data);
			if (!catalog) {
				const error = new Error("Map zone catalog response was malformed");
				this.rejectPendingMapZoneCatalogRead(error);
				await setMapZoneCatalogReadFailure(this, error);
				await projectZoneCleaningCatalog(this, zoneCleaningOptions(this.latestMapCoordinateMetadata), false);
				return;
			}
			if (this.latestMapId !== undefined && catalog.mapId !== this.latestMapId) {
				const error = new Error("Map zone catalog did not match the active map");
				this.rejectPendingMapZoneCatalogRead(error);
				await setMapZoneCatalogReadFailure(this, error);
				await projectZoneCleaningCatalog(this, [], false);
				return;
			}

			this.latestMapCoordinateMetadata = replaceLiveMapZoneCatalog(this.latestMapCoordinateMetadata, catalog);
			this.latestMapZoneCatalogCount = catalog.area?.length ?? 0;
			this.hasLoadedMapZoneCatalog = true;
			this.resolvePendingMapZoneCatalogRead(catalog);
			await projectMapZoneCatalogReadSuccess(this, this.latestMapZoneCatalogCount);
			const options = zoneCleaningOptions(catalog);
			await projectZoneCleaningCatalog(
				this,
				options,
				this.commandEnabled &&
					options.length > 0 &&
					this.latestMapId !== undefined &&
					catalog.mapId === this.latestMapId,
			);
			await this.projectLatestLiveMapImage("zones");
			return;
		}

		if (infoType === 20001) {
			const status = normalizeStatus20001(data);
			if (status) {
				this.confirmPendingCommand(status);
				const previousStatus = this.latestRobotStatus;
				if (status.mode === "sweep" || hasCleaningProgress(status, previousStatus)) {
					this.cleaningInferredUntilMs = Date.now() + CLEANING_ACTIVITY_HOLD_MS;
				}
				this.latestRobotStatus = status;
				await this.updateLiveMapTaskState(status, previousStatus);
				await projectStatus(this, status);
				await this.projectDerivedRobotActivity(previousStatus);
			}

			const pose = extractRobotPose20001(data);
			if (pose) {
				this.lastPoseUpdated = new Date().toISOString();
				this.recentRobotPoses.push(pose);
				if (this.recentRobotPoses.length > MAX_LIVE_MAP_POSES) {
					this.recentRobotPoses = this.recentRobotPoses.slice(-MAX_LIVE_MAP_POSES);
				}
				await this.projectLatestLiveMapImage("pose");
			}
			return;
		}

		if (infoType === 20002) {
			const map = normalizeMap20002(data);
			const coordinateMetadata = extractLiveMapCoordinateMetadata20002(data);
			let mapChanged = false;
			if (map) {
				const knownMapId = this.latestMapId ?? this.latestMapCoordinateMetadata?.mapId;
				if (map.mapId !== undefined && knownMapId !== undefined && map.mapId !== knownMapId) {
					this.latestMapCoordinateMetadata = undefined;
					this.latestMapZoneCatalogCount = 0;
					this.hasLoadedMapZoneCatalog = false;
					mapChanged = true;
					await initializeLiveMapAreaStates(this);
					await projectZoneCleaningCatalog(this, [], false);
				}
				if (map.pathId !== undefined) {
					this.latestMapPathId = map.pathId;
				}
				if (map.mapId !== undefined) {
					this.latestMapId = map.mapId;
				}
				if (coordinateMetadata) {
					this.latestMapCoordinateMetadata = mergeLiveMapCoordinateMetadataCache(
						this.latestMapCoordinateMetadata,
						coordinateMetadata,
					);
				}
				await projectMapMetadata(this, map);
				const zoneOptions = zoneCleaningOptions(this.latestMapCoordinateMetadata);
				await projectZoneCleaningCatalog(
					this,
					zoneOptions,
					this.commandEnabled &&
						this.hasLoadedMapZoneCatalog &&
						zoneOptions.length > 0 &&
						this.latestMapCoordinateMetadata?.mapId === this.latestMapId,
				);
			}
			this.latestMapData = data;
			await this.projectLatestLiveMapImage("map");
			if (mapChanged || !this.hasLoadedMapZoneCatalog) {
				void this.refreshMapZoneCatalog(mapChanged);
			}
			return;
		}

		if (infoType === 20003) {
			const message = normalizeMaintenanceMessage20003(data);
			if (message) {
				this.maintenanceEventCount += 1;
				await projectMaintenanceMessage(this, message, this.maintenanceEventCount);
			}
		}
	}

	private async refreshVerifiedReadPathsIfDue(): Promise<void> {
		if (this.auxiliaryReadInProgress || this.shuttingDown) {
			return;
		}
		if (!this.commandEnabled) {
			return;
		}
		if (!this.commandClient || !this.commandToken || !this.commandSerial) {
			return;
		}
		const now = Date.now();
		if (this.lastAuxiliaryReadAt !== 0 && now - this.lastAuxiliaryReadAt < AUXILIARY_READ_INTERVAL_MS) {
			return;
		}

		this.lastAuxiliaryReadAt = now;
		this.auxiliaryReadInProgress = true;
		try {
			await Promise.all([
				this.refreshMaintenanceHistory(),
				this.refreshConsumables(),
				this.refreshMapZoneCatalog(),
			]);
		} finally {
			this.auxiliaryReadInProgress = false;
		}
	}

	private async refreshMaintenanceHistory(): Promise<void> {
		if (!this.commandClient || !this.commandToken || !this.commandSerial) {
			return;
		}

		try {
			const data = await this.commandClient.getMaintenanceHistory(this.commandToken, this.commandSerial);
			const history = normalizeMaintenanceHistory20003(data);
			if (!history) {
				throw new Error("Maintenance history response did not contain usable events");
			}
			await projectMaintenanceHistory(this, history);
		} catch (error) {
			await setMaintenanceHistoryReadFailure(this, error);
			this.log.debug(`Could not refresh Proscenic maintenance history: ${redactedErrorMessage(error)}`);
		}
	}

	private async refreshConsumables(): Promise<void> {
		const session = this.currentCommandSession();
		if (!session) {
			return;
		}

		try {
			await this.runConsumableOperation(() => this.requestConsumableSnapshot(session));
		} catch (error) {
			await setConsumablesReadFailure(this, error);
			this.log.debug(`Could not refresh Proscenic consumables: ${redactedErrorMessage(error)}`);
		}
	}

	private async refreshMapZoneCatalog(force = false): Promise<void> {
		const session = this.currentCommandSession();
		if (!session || this.pendingMapZoneCatalogRead) {
			return;
		}
		const now = Date.now();
		if (!force && now - this.lastMapZoneCatalogRequestAt < MAP_ZONE_CATALOG_RETRY_INTERVAL_MS) {
			return;
		}
		this.lastMapZoneCatalogRequestAt = now;

		try {
			await this.requestMapZoneCatalog(session);
		} catch (error) {
			await setMapZoneCatalogReadFailure(this, error);
			await projectZoneCleaningCatalog(this, zoneCleaningOptions(this.latestMapCoordinateMetadata), false);
			this.log.debug(`Could not refresh Proscenic map zones: ${redactedErrorMessage(error)}`);
		}
	}

	private async requestMapZoneCatalog(session: CommandSession): Promise<LiveMapCoordinateMetadata> {
		if (this.pendingMapZoneCatalogRead) {
			return this.pendingMapZoneCatalogRead.promise;
		}
		this.lastMapZoneCatalogRequestAt = Date.now();
		const event = this.awaitNextMapZoneCatalog();
		try {
			await session.client.requestMapZoneCatalog(session.token, session.serial);
			return await event;
		} catch (error) {
			void event.catch(() => undefined);
			this.rejectPendingMapZoneCatalogRead(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
	}

	private awaitNextMapZoneCatalog(): Promise<LiveMapCoordinateMetadata> {
		if (this.pendingMapZoneCatalogRead) {
			throw new Error("Another map zone catalog read is already pending");
		}

		let resolvePending: (catalog: LiveMapCoordinateMetadata) => void = () => undefined;
		let rejectPending: (error: Error) => void = () => undefined;
		const promise = new Promise<LiveMapCoordinateMetadata>((resolve, reject) => {
			resolvePending = resolve;
			rejectPending = reject;
		});
		const timer = this.setTimeout(() => {
			this.pendingMapZoneCatalogRead = undefined;
			rejectPending(new Error(`No map zone catalog received within ${MAP_ZONE_CATALOG_TIMEOUT_MS} ms`));
		}, MAP_ZONE_CATALOG_TIMEOUT_MS);
		if (timer === undefined) {
			rejectPending(new Error("Could not schedule map zone catalog timeout"));
			return promise;
		}
		this.pendingMapZoneCatalogRead = {
			promise,
			timer,
			resolve: resolvePending,
			reject: rejectPending,
		};
		return promise;
	}

	private resolvePendingMapZoneCatalogRead(catalog: LiveMapCoordinateMetadata): void {
		if (!this.pendingMapZoneCatalogRead) {
			return;
		}
		this.clearTimeout(this.pendingMapZoneCatalogRead.timer);
		this.pendingMapZoneCatalogRead.resolve(catalog);
		this.pendingMapZoneCatalogRead = undefined;
	}

	private rejectPendingMapZoneCatalogRead(error: Error): void {
		if (!this.pendingMapZoneCatalogRead) {
			return;
		}
		this.clearTimeout(this.pendingMapZoneCatalogRead.timer);
		this.pendingMapZoneCatalogRead.reject(error);
		this.pendingMapZoneCatalogRead = undefined;
	}

	private runConsumableOperation<T>(operation: () => Promise<T>): Promise<T> {
		const execution = this.consumableOperationChain.catch(() => undefined).then(operation);
		this.consumableOperationChain = execution.then(
			() => undefined,
			() => undefined,
		);
		return execution;
	}

	private async requestConsumableSnapshot(session: CommandSession): Promise<ConsumableCounterSnapshot> {
		const event = this.awaitNextConsumableEvent(21015);
		try {
			const result = await session.client.requestConsumables(session.token, session.serial);
			if (result.code !== undefined && result.code !== 0) {
				throw new Error(`Consumable read was rejected with API code ${result.code}`);
			}
			return await event;
		} catch (error) {
			void event.catch(() => undefined);
			this.rejectPendingConsumableEvent(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
	}

	private awaitNextConsumableEvent(expectedInfoType: 21015 | 21016): Promise<ConsumableCounterSnapshot> {
		if (this.pendingConsumableEvent) {
			throw new Error("Another consumable gateway operation is already pending");
		}

		return new Promise<ConsumableCounterSnapshot>((resolve, reject) => {
			const timer = this.setTimeout(() => {
				this.pendingConsumableEvent = undefined;
				reject(
					new Error(
						`No consumable ${expectedInfoType} gateway event received within ${CONSUMABLE_GATEWAY_TIMEOUT_MS} ms`,
					),
				);
			}, CONSUMABLE_GATEWAY_TIMEOUT_MS);
			if (timer === undefined) {
				reject(new Error("Could not schedule consumable gateway timeout"));
				return;
			}
			this.pendingConsumableEvent = { expectedInfoType, timer, resolve, reject };
		});
	}

	private resolvePendingConsumableEvent(infoType: 21015 | 21016, snapshot: ConsumableCounterSnapshot): void {
		if (!this.pendingConsumableEvent || this.pendingConsumableEvent.expectedInfoType !== infoType) {
			return;
		}
		this.clearTimeout(this.pendingConsumableEvent.timer);
		this.pendingConsumableEvent.resolve(snapshot);
		this.pendingConsumableEvent = undefined;
	}

	private rejectPendingConsumableEvent(error: Error): void {
		if (!this.pendingConsumableEvent) {
			return;
		}
		this.clearTimeout(this.pendingConsumableEvent.timer);
		this.pendingConsumableEvent.reject(error);
		this.pendingConsumableEvent = undefined;
	}

	private async updateLiveMapTaskState(status: RobotStatus, previousStatus: RobotStatus | undefined): Promise<void> {
		if (status.mode === "sweep" || hasCleaningProgress(status, previousStatus)) {
			this.clearZoneCleaningCompletionTimer();
			this.zoneCleaningActivityObserved = this.zoneCleaningCompletionPending;
			this.zoneCleaningPaused = false;
		} else if (status.mode === "pause" && this.zoneCleaningCompletionPending) {
			this.clearZoneCleaningCompletionTimer();
			this.zoneCleaningPaused = true;
		} else if (status.mode === "backcharge" && this.zoneCleaningCompletionPending) {
			this.clearZoneCleaningCompletionTimer();
			this.zoneCleaningPaused = false;
		}

		const transition = transitionLiveMapTaskState(
			{
				dockedSinceLastCleaning: this.liveMapDockedSinceLastCleaning,
				returningToDock: this.liveMapReturningToDock,
				cleaningTaskActive: this.liveMapCleaningTaskActive,
			},
			status.mode,
			this.cleaningInferredUntilMs > Date.now(),
		);
		if (transition.resetTrail) {
			this.resetLiveMapPoseTrail();
		}
		this.liveMapDockedSinceLastCleaning = transition.state.dockedSinceLastCleaning;
		this.liveMapReturningToDock = transition.state.returningToDock;
		this.liveMapCleaningTaskActive = transition.state.cleaningTaskActive;
		const recoveredZoneTaskCompleted = this.isRecoveredZoneTaskCompleted(status);
		if (transition.completedTask || recoveredZoneTaskCompleted) {
			await this.clearCompletedZoneSelection();
		} else if (
			this.zoneCleaningCompletionPending &&
			this.zoneCleaningActivityObserved &&
			!this.zoneCleaningPaused &&
			(status.mode === "charge" || status.mode === "fullcharge")
		) {
			this.scheduleZoneCleaningCompletionCheck();
		}
	}

	private isRecoveredZoneTaskCompleted(status: RobotStatus): boolean {
		return (
			this.zoneCleaningCompletionPending &&
			this.zoneCleaningActivityObserved &&
			!this.zoneCleaningPaused &&
			(status.mode === "charge" || status.mode === "fullcharge") &&
			this.cleaningInferredUntilMs <= Date.now()
		);
	}

	private async clearCompletedZoneSelection(): Promise<void> {
		this.clearZoneCleaningCompletionTimer();
		this.zoneCleaningCompletionPending = false;
		this.zoneCleaningActivityObserved = false;
		this.zoneCleaningPaused = false;
		if (this.selectedZoneIds.length === 0) {
			return;
		}
		this.selectedZoneIds = [];
		await this.setStateAsync("commands.zones.selectedIds", { val: "[]", ack: true });
		await this.projectLatestLiveMapImage("zones");
	}

	private scheduleZoneCleaningCompletionCheck(): void {
		this.clearZoneCleaningCompletionTimer();
		const delayMs = Math.max(1, this.cleaningInferredUntilMs - Date.now() + 100);
		this.zoneCleaningCompletionTimer = this.setTimeout(() => {
			this.zoneCleaningCompletionTimer = undefined;
			const status = this.latestRobotStatus;
			if (!status || !this.isRecoveredZoneTaskCompleted(status)) {
				return;
			}
			void this.clearCompletedZoneSelection().catch(error => {
				this.log.debug(`Could not clear completed zone selection: ${redactedErrorMessage(error)}`);
			});
		}, delayMs);
	}

	private clearZoneCleaningCompletionTimer(): void {
		if (this.zoneCleaningCompletionTimer !== undefined) {
			this.clearTimeout(this.zoneCleaningCompletionTimer);
			this.zoneCleaningCompletionTimer = undefined;
		}
	}

	private resetLiveMapPoseTrail(): void {
		this.recentRobotPoses = [];
		this.liveMapPathResetCount += 1;
		this.lastPoseUpdated = undefined;
	}

	private async projectLatestLiveMapImage(renderReason: "map" | "pose" | "zones"): Promise<void> {
		if (!this.latestMapData) {
			return;
		}

		try {
			const renderData = mergeLiveMapCoordinateMetadata20002(
				this.latestMapData,
				this.latestMapCoordinateMetadata,
			);
			const image = renderLiveMapImage20002(renderData, this.recentRobotPoses, {
				canvasBackgroundColor: this.liveMapCanvasBackgroundColor,
				mapBackgroundColor: this.liveMapMapBackgroundColor,
				animateRobot: renderReason === "pose",
				showZoneOverlays: this.liveMapShowZoneOverlays,
				selectedZoneIds: this.selectedZoneIds,
			});
			if (image) {
				await projectLiveMapImage(this, image, {
					renderReason,
					lastPathId: this.latestMapPathId,
					pathResetCount: this.liveMapPathResetCount,
					lastPoseUpdated: this.lastPoseUpdated,
					currentAreaCount: this.latestMapZoneCatalogCount,
					cachedAreaCount: this.latestMapCoordinateMetadata?.area?.length ?? 0,
					hasCachedStaticOverlays:
						(this.latestMapCoordinateMetadata?.area?.length ?? 0) > 0 ||
						this.latestMapCoordinateMetadata?.chargeHandlePos !== undefined,
				});
			}
		} catch (error) {
			this.log.debug(`Could not render experimental live map image: ${redactedErrorMessage(error)}`);
		}
	}

	// If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
	// You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
	// /**
	//  * Is called if a subscribed object changes
	//  */
	// private onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void {
	// 	if (obj) {
	// 		// The object was changed
	// 		this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
	// 	} else {
	// 		// The object was deleted
	// 		this.log.info(`object ${id} deleted`);
	// 	}
	// }

	/**
	 * Is called if a subscribed state changes
	 *
	 * @param id - State ID
	 * @param state - State object
	 */
	private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
		if (!state || state.ack !== false) {
			return;
		}

		const relativeId = this.relativeStateId(id);
		if (relativeId === "map.live.backgroundColor" || relativeId === "map.live.mapBackgroundColor") {
			void this.setLiveMapMapBackgroundColor(state.val);
			return;
		}
		if (relativeId === "map.live.canvasBackgroundColor") {
			void this.setLiveMapCanvasBackgroundColor(state.val);
			return;
		}
		if (relativeId === "map.live.showZoneOverlays") {
			void this.setLiveMapShowZoneOverlays(state.val);
			return;
		}
		if (relativeId === "commands.zones.selectedIds") {
			void this.setSelectedZoneIds(state.val);
			return;
		}
		if (relativeId === "commands.zones.start") {
			const trigger = normalizeCommandButtonValue(state.val);
			if (trigger === false) {
				void this.setStateAsync(relativeId, { val: false, ack: true });
				return;
			}
			if (trigger === undefined) {
				this.log.debug("Ignoring unsupported zone-cleaning button value.");
				return;
			}
			this.enqueueZoneCleaning(relativeId, this.selectedZoneIds);
			return;
		}

		const consumableReset = consumableResetForStateId(relativeId);
		if (consumableReset) {
			const trigger = normalizeCommandButtonValue(state.val);
			if (trigger === false) {
				void this.setStateAsync(relativeId, { val: false, ack: true });
				return;
			}
			if (trigger === undefined) {
				this.log.debug(`Ignoring unsupported consumable reset button value for ${relativeId}.`);
				return;
			}
			this.enqueueConsumableReset(relativeId, consumableReset);
			return;
		}

		const command = commandForStateId(relativeId);
		if (!command) {
			this.log.debug(`Ignoring unsupported state command for ${relativeId}.`);
			return;
		}

		const trigger = normalizeCommandButtonValue(state.val);
		if (trigger === false) {
			void this.setStateAsync(relativeId, { val: false, ack: true });
			return;
		}
		if (trigger === undefined) {
			this.log.debug(`Ignoring unsupported command button value for ${relativeId}.`);
			return;
		}

		this.enqueueCommand(relativeId, command);
	}

	private relativeStateId(id: string): string {
		const prefix = `${this.namespace}.`;
		return id.startsWith(prefix) ? id.slice(prefix.length) : id;
	}

	private enqueueCommand(stateId: string, command: RobotCommand): void {
		if (this.queuedCommandCount >= MAX_QUEUED_COMMANDS) {
			void this.setCommandFailure(stateId, command, new Error("Proscenic command queue is full"));
			return;
		}

		this.queuedCommandCount += 1;
		void this.setStateAsync(stateId, { val: false, ack: true });
		void this.setStateAsync("commands.queueDepth", { val: this.queuedCommandCount, ack: true });
		const execution = this.commandExecutionChain
			.catch(() => undefined)
			.then(() => this.executeCommand(stateId, command));
		this.commandExecutionChain = execution.finally(async () => {
			this.queuedCommandCount = Math.max(0, this.queuedCommandCount - 1);
			await this.setStateAsync("commands.queueDepth", { val: this.queuedCommandCount, ack: true });
		});
	}

	private enqueueZoneCleaning(stateId: string, zoneIds: readonly number[]): void {
		if (this.queuedCommandCount >= MAX_QUEUED_COMMANDS) {
			void this.setCommandFailure(stateId, "zoneCleaning", new Error("Proscenic command queue is full"));
			return;
		}

		this.queuedCommandCount += 1;
		void this.setStateAsync(stateId, { val: false, ack: true });
		void this.setStateAsync("commands.queueDepth", { val: this.queuedCommandCount, ack: true });
		const selected = [...zoneIds];
		const execution = this.commandExecutionChain
			.catch(() => undefined)
			.then(() => this.executeZoneCleaning(stateId, selected));
		this.commandExecutionChain = execution.finally(async () => {
			this.queuedCommandCount = Math.max(0, this.queuedCommandCount - 1);
			await this.setStateAsync("commands.queueDepth", { val: this.queuedCommandCount, ack: true });
		});
	}

	private enqueueConsumableReset(stateId: string, component: ConsumableComponent): void {
		if (this.queuedCommandCount >= MAX_QUEUED_COMMANDS) {
			void this.setConsumableResetFailure(stateId, component, new Error("Proscenic command queue is full"));
			return;
		}

		this.queuedCommandCount += 1;
		void this.setStateAsync(stateId, { val: false, ack: true });
		void this.setStateAsync("commands.queueDepth", { val: this.queuedCommandCount, ack: true });
		const execution = this.commandExecutionChain
			.catch(() => undefined)
			.then(() => this.executeConsumableReset(stateId, component));
		this.commandExecutionChain = execution.finally(async () => {
			this.queuedCommandCount = Math.max(0, this.queuedCommandCount - 1);
			await this.setStateAsync("commands.queueDepth", { val: this.queuedCommandCount, ack: true });
		});
	}

	private async executeConsumableReset(stateId: string, component: ConsumableComponent): Promise<void> {
		await projectConsumableResetProgress(this, component, "waiting-for-session");

		try {
			const session = await this.waitForCommandSession();
			if (!this.commandEnabled) {
				throw new Error("Consumable resets are not enabled for the selected device");
			}

			await this.runConsumableOperation(async () => {
				await runSafeConsumableReset(component, {
					readSnapshot: async () => {
						const snapshot = await this.requestConsumableSnapshot(session);
						await setConsumableResetCapability(this, true);
						return snapshot;
					},
					sendReset: before => this.sendConsumableReset(session, component, before),
					onProgress: result => projectConsumableResetProgress(this, component, result),
				});
			});
		} catch (error) {
			await this.setConsumableResetFailure(stateId, component, error);
		}
	}

	private async executeZoneCleaning(stateId: string, zoneIds: readonly number[]): Promise<void> {
		await this.setStateAsync("commands.lastCommand", { val: "zoneCleaning", ack: true });
		await this.setStateAsync("commands.lastResult", { val: "waiting-for-session", ack: true });
		await this.setStateAsync("commands.lastError", { val: "", ack: true });
		await this.setStateAsync("commands.lastExecution", { val: new Date().toISOString(), ack: true });
		await this.setStateAsync("commands.lastApiLatencyMs", { val: 0, ack: true });
		await this.setStateAsync("commands.lastConfirmationLatencyMs", { val: 0, ack: true });

		let requestAttempted = false;
		try {
			const session = await this.waitForCommandSession();
			if (!this.commandEnabled) {
				throw new Error("Zone cleaning is not enabled for the selected device");
			}
			if (zoneIds.length === 0) {
				throw new Error("No map zones are selected");
			}

			await this.setStateAsync("commands.lastResult", { val: "validating-zones", ack: true });
			const catalog = await this.requestMapZoneCatalog(session);
			const selection = validateZoneCleaningSelection(zoneIds, this.latestMapId, catalog);
			const request = buildZoneCleaningRequest(selection, session.serial, session.username);

			await this.setStateAsync("commands.lastResult", { val: "sending", ack: true });
			const apiStartedAt = Date.now();
			requestAttempted = true;
			const result = await session.client.sendCommand(session.token, request);
			const apiLatencyMs = Date.now() - apiStartedAt;
			const accepted = result.code === undefined || result.code === 0;
			if (accepted) {
				this.clearZoneCleaningCompletionTimer();
				this.zoneCleaningCompletionPending = true;
				this.zoneCleaningActivityObserved = false;
				this.zoneCleaningPaused = false;
			}
			const confirmation = accepted
				? this.waitForCommandConfirmation("zoneCleaning")
				: Promise.resolve(undefined);
			await this.setStateAsync("commands.lastApiLatencyMs", { val: apiLatencyMs, ack: true });
			await this.setStateAsync("commands.lastResult", {
				val: accepted ? "api-accepted" : `api-code-${result.code}`,
				ack: true,
			});

			if (accepted) {
				const confirmationLatencyMs = await confirmation;
				if (confirmationLatencyMs !== undefined) {
					await this.setStateAsync("commands.lastConfirmationLatencyMs", {
						val: confirmationLatencyMs,
						ack: true,
					});
					await this.setStateAsync("commands.lastResult", { val: "status-confirmed", ack: true });
				} else {
					await this.setStateAsync("commands.lastConfirmationLatencyMs", {
						val: COMMAND_CONFIRMATION_TIMEOUT_MS,
						ack: true,
					});
					await this.setStateAsync("commands.lastResult", { val: "api-accepted-unconfirmed", ack: true });
				}
			}
		} catch (error) {
			this.cancelPendingCommandConfirmation();
			if (requestAttempted) {
				this.recoverCommandSessionAfterFailure();
			}
			await this.setCommandFailure(stateId, "zoneCleaning", error);
		}
	}

	private async sendConsumableReset(
		session: CommandSession,
		component: ConsumableComponent,
		before: ConsumableCounterSnapshot,
	): Promise<ConsumableCounterSnapshot> {
		const request = buildConsumableResetRequest(component, before, session.serial, session.username);
		const echoEvent = this.awaitNextConsumableEvent(21016);
		try {
			const result = await session.client.sendCommand(session.token, request);
			if (result.code !== undefined && result.code !== 0) {
				throw new Error(`Consumable reset was rejected with API code ${result.code}`);
			}
			return await echoEvent;
		} catch (error) {
			void echoEvent.catch(() => undefined);
			this.rejectPendingConsumableEvent(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
	}

	private async executeCommand(stateId: string, command: RobotCommand): Promise<void> {
		await this.setStateAsync("commands.lastCommand", { val: command, ack: true });
		await this.setStateAsync("commands.lastResult", { val: "waiting-for-session", ack: true });
		await this.setStateAsync("commands.lastError", { val: "", ack: true });
		await this.setStateAsync("commands.lastExecution", { val: new Date().toISOString(), ack: true });
		await this.setStateAsync("commands.lastApiLatencyMs", { val: 0, ack: true });
		await this.setStateAsync("commands.lastConfirmationLatencyMs", { val: 0, ack: true });

		try {
			const session = await this.waitForCommandSession();
			if (!this.commandEnabled) {
				throw new Error("Proscenic commands are not enabled for the selected device");
			}

			await this.setStateAsync("commands.lastResult", { val: "sending", ack: true });
			const request = buildCommandRequest(command, session.serial, session.username);
			const apiStartedAt = Date.now();
			const result = await session.client.sendCommand(session.token, request);
			const apiLatencyMs = Date.now() - apiStartedAt;
			const confirmation =
				result.code === undefined || result.code === 0
					? this.waitForCommandConfirmation(command)
					: Promise.resolve(undefined);
			await this.setStateAsync("commands.lastApiLatencyMs", { val: apiLatencyMs, ack: true });
			await this.setStateAsync("commands.lastResult", {
				val: result.code === undefined || result.code === 0 ? "api-accepted" : `api-code-${result.code}`,
				ack: true,
			});

			if (result.code === undefined || result.code === 0) {
				const confirmationLatencyMs = await confirmation;
				if (confirmationLatencyMs !== undefined) {
					await this.setStateAsync("commands.lastConfirmationLatencyMs", {
						val: confirmationLatencyMs,
						ack: true,
					});
					await this.setStateAsync("commands.lastResult", { val: "status-confirmed", ack: true });
				} else if (supportsStatusConfirmation(command)) {
					await this.setStateAsync("commands.lastConfirmationLatencyMs", {
						val: COMMAND_CONFIRMATION_TIMEOUT_MS,
						ack: true,
					});
					await this.setStateAsync("commands.lastResult", { val: "api-accepted-unconfirmed", ack: true });
				}
			}
		} catch (error) {
			this.cancelPendingCommandConfirmation();
			this.recoverCommandSessionAfterFailure();
			await this.setCommandFailure(stateId, command, error);
		}
	}

	private currentCommandSession(): CommandSession | undefined {
		if (!this.commandClient || !this.commandToken || !this.commandSerial || !this.config.username) {
			return undefined;
		}

		return {
			client: this.commandClient,
			token: this.commandToken,
			serial: this.commandSerial,
			username: this.config.username,
		};
	}

	private async waitForCommandSession(): Promise<CommandSession> {
		const current = this.currentCommandSession();
		if (current) {
			return current;
		}
		if (!this.config.username || !this.config.password) {
			throw new Error("Proscenic cloud credentials are not configured");
		}

		this.clearReconnectTimer();
		void this.connectReadOnlyGateway();
		const deadline = Date.now() + COMMAND_SESSION_WAIT_MS;
		while (!this.shuttingDown && Date.now() < deadline) {
			await this.commandDelay(COMMAND_SESSION_POLL_MS);
			const session = this.currentCommandSession();
			if (session) {
				return session;
			}
		}

		throw new Error("Proscenic command session did not recover in time");
	}

	private commandDelay(delayMs: number): Promise<void> {
		return new Promise(resolve => this.setTimeout(resolve, delayMs));
	}

	private waitForCommandConfirmation(command: ConfirmableRobotCommand): Promise<number | undefined> {
		if (!supportsStatusConfirmation(command)) {
			return Promise.resolve(undefined);
		}

		this.cancelPendingCommandConfirmation();
		return new Promise(resolve => {
			const acceptedAt = Date.now();
			const timer = this.setTimeout(() => {
				if (this.pendingCommandConfirmation?.command === command) {
					this.pendingCommandConfirmation = undefined;
				}
				resolve(undefined);
			}, COMMAND_CONFIRMATION_TIMEOUT_MS);
			this.pendingCommandConfirmation = { command, acceptedAt, timer, resolve };
		});
	}

	private confirmPendingCommand(status: RobotStatus): void {
		const pending = this.pendingCommandConfirmation;
		if (!pending || !isStatusConfirmationForCommand(pending.command, status)) {
			return;
		}

		this.pendingCommandConfirmation = undefined;
		if (pending.timer) {
			this.clearTimeout(pending.timer);
		}
		pending.resolve(Date.now() - pending.acceptedAt);
	}

	private cancelPendingCommandConfirmation(): void {
		const pending = this.pendingCommandConfirmation;
		if (!pending) {
			return;
		}

		this.pendingCommandConfirmation = undefined;
		if (pending.timer) {
			this.clearTimeout(pending.timer);
		}
		pending.resolve(undefined);
	}

	private recoverCommandSessionAfterFailure(): void {
		if (this.shuttingDown) {
			return;
		}

		this.clearCommandSession();
		this.clearReconnectTimer();
		void this.setCloudConnection(false);
		void this.connectReadOnlyGateway();
	}

	private async setCommandFailure(stateId: string, command: ConfirmableRobotCommand, error: unknown): Promise<void> {
		const message = redactedErrorMessage(error);
		await this.setStateAsync("commands.lastCommand", { val: command, ack: true });
		await this.setStateAsync("commands.lastResult", { val: "failed", ack: true });
		await this.setStateAsync("commands.lastError", { val: message, ack: true });
		await this.setStateAsync("commands.lastExecution", { val: new Date().toISOString(), ack: true });
		await this.setStateAsync(stateId, { val: false, ack: true });
		this.log.warn(`Proscenic command ${command} failed: ${message}`);
	}

	private async setConsumableResetFailure(
		stateId: string,
		component: ConsumableComponent,
		error: unknown,
	): Promise<void> {
		const message = redactedErrorMessage(error);
		await setConsumableResetFailure(this, component, error);
		await this.setStateAsync(stateId, { val: false, ack: true });
		this.log.warn(`Proscenic consumable reset for ${component} failed: ${message}`);
	}

	private clearCommandSession(): void {
		this.rejectPendingMapZoneCatalogRead(new Error("Cloud session ended before map zones were received"));
		this.commandEnabled = false;
		void setConsumableResetCapability(this, false);
		void this.setStateAsync("capabilities.zoneCleaning", { val: false, ack: true });
		this.commandClient = undefined;
		this.commandToken = undefined;
		this.commandSerial = undefined;
		this.commandGatewayEndpoint = undefined;
	}

	private async initializeLiveMapColors(): Promise<void> {
		const currentCanvasBackground = await this.getStateAsync("map.live.canvasBackgroundColor");
		const normalizedCanvasBackground = normalizeLiveMapBackgroundColor(currentCanvasBackground?.val);
		this.liveMapCanvasBackgroundColor = normalizedCanvasBackground ?? DEFAULT_LIVE_MAP_CANVAS_BACKGROUND_COLOR;
		await this.setStateAsync("map.live.canvasBackgroundColor", {
			val: this.liveMapCanvasBackgroundColor,
			ack: true,
		});

		const currentMapBackground = await this.getStateAsync("map.live.mapBackgroundColor");
		const current = await this.getStateAsync("map.live.backgroundColor");
		const normalizedNewMapBackground = normalizeLiveMapBackgroundColor(currentMapBackground?.val);
		const normalizedLegacyMapBackground = normalizeLiveMapBackgroundColor(current?.val);
		const normalizedMapBackground = normalizedNewMapBackground ?? normalizedLegacyMapBackground;
		this.liveMapMapBackgroundColor = normalizedMapBackground ?? DEFAULT_LIVE_MAP_BACKGROUND_COLOR;
		await this.setStateAsync("map.live.mapBackgroundColor", { val: this.liveMapMapBackgroundColor, ack: true });
		await this.setStateAsync("map.live.backgroundColor", { val: this.liveMapMapBackgroundColor, ack: true });

		const currentShowZoneOverlays = await this.getStateAsync("map.live.showZoneOverlays");
		const showZoneOverlays = normalizeCommandButtonValue(currentShowZoneOverlays?.val);
		this.liveMapShowZoneOverlays = showZoneOverlays ?? true;
		await this.setStateAsync("map.live.showZoneOverlays", { val: this.liveMapShowZoneOverlays, ack: true });

		await this.deleteObsoleteLiveMapRoomColor();
	}

	private async initializeZoneCleaningControls(): Promise<void> {
		const [current, lastCommand, lastResult, lastExecution] = await Promise.all([
			this.getStateAsync("commands.zones.selectedIds"),
			this.getStateAsync("commands.lastCommand"),
			this.getStateAsync("commands.lastResult"),
			this.getStateAsync("commands.lastExecution"),
		]);
		const selected = normalizeZoneSelection(current?.val);
		this.selectedZoneIds = selected ?? [];
		this.zoneCleaningCompletionPending = shouldRecoverPendingZoneCleaningSelection(
			this.selectedZoneIds.length,
			current?.lc ?? current?.ts,
			lastCommand?.val,
			lastResult?.val,
			lastExecution?.val,
		);
		this.zoneCleaningActivityObserved =
			this.zoneCleaningCompletionPending && lastResult?.val === "status-confirmed";
		this.zoneCleaningPaused = false;
		await this.setStateAsync("commands.zones.selectedIds", {
			val: JSON.stringify(this.selectedZoneIds),
			ack: true,
		});
		await this.setStateAsync("commands.zones.start", { val: false, ack: true });
		await projectZoneCleaningCatalog(this, [], false);
	}

	private async setLiveMapMapBackgroundColor(value: ioBroker.StateValue | undefined): Promise<void> {
		const normalized = normalizeLiveMapBackgroundColor(value);
		if (!normalized) {
			await this.setStateAsync("map.live.mapBackgroundColor", { val: this.liveMapMapBackgroundColor, ack: true });
			await this.setStateAsync("map.live.backgroundColor", { val: this.liveMapMapBackgroundColor, ack: true });
			this.log.warn("Ignoring invalid live map blue area color. Expected a #RRGGBB value.");
			return;
		}

		this.liveMapMapBackgroundColor = normalized;
		await this.setStateAsync("map.live.mapBackgroundColor", { val: normalized, ack: true });
		await this.setStateAsync("map.live.backgroundColor", { val: normalized, ack: true });
		await this.projectLatestLiveMapImage("map");
	}

	private async setLiveMapCanvasBackgroundColor(value: ioBroker.StateValue | undefined): Promise<void> {
		const normalized = normalizeLiveMapBackgroundColor(value);
		if (!normalized) {
			await this.setStateAsync("map.live.canvasBackgroundColor", {
				val: this.liveMapCanvasBackgroundColor,
				ack: true,
			});
			this.log.warn("Ignoring invalid live map canvas background color. Expected a #RRGGBB value.");
			return;
		}

		this.liveMapCanvasBackgroundColor = normalized;
		await this.setStateAsync("map.live.canvasBackgroundColor", { val: normalized, ack: true });
		await this.projectLatestLiveMapImage("map");
	}

	private async setLiveMapShowZoneOverlays(value: ioBroker.StateValue | undefined): Promise<void> {
		const normalized = normalizeCommandButtonValue(value);
		if (normalized === undefined) {
			await this.setStateAsync("map.live.showZoneOverlays", {
				val: this.liveMapShowZoneOverlays,
				ack: true,
			});
			this.log.warn("Ignoring invalid live map zone-overlay switch value.");
			return;
		}

		this.liveMapShowZoneOverlays = normalized;
		await this.setStateAsync("map.live.showZoneOverlays", { val: normalized, ack: true });
		await this.projectLatestLiveMapImage("map");
	}

	private async setSelectedZoneIds(value: ioBroker.StateValue | undefined): Promise<void> {
		const normalized = normalizeZoneSelection(value);
		if (!normalized) {
			await this.setStateAsync("commands.zones.selectedIds", {
				val: JSON.stringify(this.selectedZoneIds),
				ack: true,
			});
			this.log.warn("Ignoring invalid zone selection. Expected a JSON array or comma-separated numeric IDs.");
			return;
		}

		this.selectedZoneIds = normalized;
		this.clearZoneCleaningCompletionTimer();
		this.zoneCleaningCompletionPending = false;
		this.zoneCleaningActivityObserved = false;
		this.zoneCleaningPaused = false;
		await this.setStateAsync("commands.zones.selectedIds", {
			val: JSON.stringify(normalized),
			ack: true,
		});
		await this.projectLatestLiveMapImage("zones");
	}

	private async deleteObsoleteLiveMapRoomColor(): Promise<void> {
		try {
			await this.delObjectAsync("map.live.roomColor");
		} catch (error) {
			this.log.debug(`Could not delete obsolete live map room color object: ${redactedErrorMessage(error)}`);
		}
	}

	// If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
	// /**
	//  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	//  * Using this method requires "common.messagebox" property to be set to true in io-package.json
	//  */
	//
	// private onMessage(obj: ioBroker.Message): void {
	// 	if (typeof obj === "object" && obj.message) {
	// 		if (obj.command === "send") {
	// 			// e.g. send email or pushover or whatever
	// 			this.log.info("send command");
	// 			// Send response in callback if required
	// 			if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
	// 		}
	// 	}
	// }
}

function selectDevice(devices: DeviceRecord[], deviceCode: string): DeviceRecord {
	if (devices.length === 0) {
		throw new Error("No Proscenic devices returned by legacy cloud");
	}

	const selected = deviceCode ? devices.find(device => device.code === deviceCode) : devices[0];
	if (!selected) {
		throw new Error("Configured Proscenic device code was not found");
	}
	if (!selected.sn) {
		throw new Error("Selected Proscenic device has no protocol serial");
	}

	return selected;
}

function isM7Pro(device: DeviceRecord): boolean {
	return device.code === "M7_PRO" && device.model === "811_LDS";
}

function selectGatewayEndpoint(gateway: GatewayData): GatewayEndpoint {
	const endpoints = selectGatewayEndpoints(gateway.addr_list);
	if (endpoints.length === 0) {
		throw new Error("No Proscenic gateway endpoint returned");
	}

	return endpoints[0];
}

function selectGatewayEndpoints(addresses: unknown): GatewayEndpoint[] {
	if (!Array.isArray(addresses)) {
		return [];
	}

	return addresses.map((entry, index) => {
		const candidate = entry as { ip?: unknown; port?: unknown };
		if (typeof candidate.ip !== "string" || candidate.ip.length === 0) {
			throw new Error(`Gateway endpoint ${index + 1} has no host`);
		}

		const port = typeof candidate.port === "number" ? candidate.port : Number.parseInt(String(candidate.port), 10);
		if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
			throw new Error(`Gateway endpoint ${index + 1} has invalid port`);
		}

		return {
			host: candidate.ip,
			port,
		};
	});
}

if (require.main !== module) {
	// Export the constructor in compact mode
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Proscenic(options);
} else {
	// otherwise start the instance directly
	(() => new Proscenic())();
}

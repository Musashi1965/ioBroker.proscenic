/*
 * Created with @iobroker/create-adapter v3.1.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from "@iobroker/adapter-core";
import { normalizeConsumables21015, type ConsumableStates } from "./domain/consumables";
import {
	buildCommandRequest,
	commandForStateId,
	isStatusConfirmationForCommand,
	normalizeCommandButtonValue,
	supportsStatusConfirmation,
	type RobotCommand,
} from "./domain/commands";
import {
	DEFAULT_LIVE_MAP_BACKGROUND_COLOR,
	DEFAULT_LIVE_MAP_CANVAS_BACKGROUND_COLOR,
	countLiveMapAreas20002,
	extractLiveMapCoordinateMetadata20002,
	extractRobotPose20001,
	mergeLiveMapCoordinateMetadataCache,
	mergeLiveMapCoordinateMetadata20002,
	normalizeLiveMapBackgroundColor,
	renderLiveMapImage20002,
	shouldResetLiveMapPoseTrailAfterPathChange,
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
import { extendAdapterObjects } from "./objects/object-definitions";
import {
	projectDevice,
	projectConsumables,
	projectLiveMapImage,
	projectMapMetadata,
	projectMaintenanceHistory,
	projectMaintenanceMessage,
	projectRobotActivity,
	projectStatus,
	redactedErrorMessage,
	setConsumablesReadFailure,
	setConnectionState,
	setDeviceListDiagnostics,
	setDeviceOnlineStale,
	setInitialCapabilityStates,
	setLastError,
	setMaintenanceHistoryReadFailure,
} from "./objects/projector";
import { ProscenicGatewayClient } from "./protocol/gateway-client";
import { ProscenicRestClient } from "./protocol/rest-client";
import type { DeviceRecord, GatewayData, GatewayEndpoint } from "./protocol/types";

const DEFAULT_TIMEOUT_MS = 10_000;
const CONSUMABLE_GATEWAY_TIMEOUT_MS = 35_000;
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

interface PendingConsumableRead {
	timer: ioBroker.Timeout;
	resolve: (consumables: ConsumableStates) => void;
	reject: (error: Error) => void;
}

interface CommandSession {
	client: ProscenicRestClient;
	token: string;
	serial: string;
	username: string;
}

interface PendingCommandConfirmation {
	command: RobotCommand;
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
	private pendingConsumableRead: PendingConsumableRead | undefined;
	private liveMapCanvasBackgroundColor = DEFAULT_LIVE_MAP_CANVAS_BACKGROUND_COLOR;
	private liveMapMapBackgroundColor = DEFAULT_LIVE_MAP_BACKGROUND_COLOR;

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
		await this.initializeLiveMapColors();
		this.subscribeStates("commands.*");
		this.subscribeStates("map.live.backgroundColor");
		this.subscribeStates("map.live.canvasBackgroundColor");
		this.subscribeStates("map.live.mapBackgroundColor");

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
			this.rejectPendingConsumableRead(new Error("Adapter unload interrupted consumable read"));
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
				this.rejectPendingConsumableRead(new Error("Gateway closed before consumable data was received"));
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
		this.rejectPendingConsumableRead(new Error(`Gateway idle watchdog: ${reason}`));
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
		if (infoType === 21015) {
			const consumables = normalizeConsumables21015(data);
			if (consumables) {
				await projectConsumables(this, consumables);
				this.resolvePendingConsumableRead(consumables);
			}
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
				this.updateLiveMapTaskState(status);
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
			if (map) {
				if (map.mapId !== undefined && this.latestMapId !== undefined && map.mapId !== this.latestMapId) {
					this.latestMapCoordinateMetadata = undefined;
				}
				if (
					map.pathId !== undefined &&
					this.latestMapPathId !== undefined &&
					map.pathId !== this.latestMapPathId
				) {
					this.resetLiveMapPoseTrailAfterDock();
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
			}
			this.latestMapData = data;
			await this.projectLatestLiveMapImage("map");
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
			await Promise.all([this.refreshMaintenanceHistory(), this.refreshConsumables()]);
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
		if (!this.commandClient || !this.commandToken || !this.commandSerial) {
			return;
		}

		let consumableRead: Promise<ConsumableStates> | undefined;
		try {
			consumableRead = this.awaitNextConsumables();
			await this.commandClient.requestConsumables(this.commandToken, this.commandSerial);
			await consumableRead;
		} catch (error) {
			void consumableRead?.catch(() => undefined);
			this.rejectPendingConsumableRead(error instanceof Error ? error : new Error(String(error)));
			await setConsumablesReadFailure(this, error);
			this.log.debug(`Could not refresh Proscenic consumables: ${redactedErrorMessage(error)}`);
		}
	}

	private awaitNextConsumables(): Promise<ConsumableStates> {
		this.rejectPendingConsumableRead(new Error("Superseded by a newer consumable read"));

		return new Promise<ConsumableStates>((resolve, reject) => {
			const timer = this.setTimeout(() => {
				this.pendingConsumableRead = undefined;
				reject(new Error(`No consumable gateway event received within ${CONSUMABLE_GATEWAY_TIMEOUT_MS} ms`));
			}, CONSUMABLE_GATEWAY_TIMEOUT_MS);
			if (timer === undefined) {
				reject(new Error("Could not schedule consumable gateway timeout"));
				return;
			}
			this.pendingConsumableRead = { timer, resolve, reject };
		});
	}

	private resolvePendingConsumableRead(consumables: ConsumableStates): void {
		if (!this.pendingConsumableRead) {
			return;
		}
		this.clearTimeout(this.pendingConsumableRead.timer);
		this.pendingConsumableRead.resolve(consumables);
		this.pendingConsumableRead = undefined;
	}

	private rejectPendingConsumableRead(error: Error): void {
		if (!this.pendingConsumableRead) {
			return;
		}
		this.clearTimeout(this.pendingConsumableRead.timer);
		this.pendingConsumableRead.reject(error);
		this.pendingConsumableRead = undefined;
	}

	private updateLiveMapTaskState(status: RobotStatus): void {
		if (status.mode === "charge") {
			this.liveMapDockedSinceLastCleaning = true;
			return;
		}
		if (status.mode === "sweep") {
			this.resetLiveMapPoseTrailAfterDock();
			this.liveMapDockedSinceLastCleaning = false;
		}
	}

	private resetLiveMapPoseTrailAfterDock(): void {
		if (
			!shouldResetLiveMapPoseTrailAfterPathChange(
				this.liveMapDockedSinceLastCleaning,
				this.recentRobotPoses.length,
			)
		) {
			return;
		}
		this.recentRobotPoses = [];
		this.liveMapPathResetCount += 1;
		this.lastPoseUpdated = undefined;
	}

	private async projectLatestLiveMapImage(renderReason: "map" | "pose"): Promise<void> {
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
			});
			if (image) {
				await projectLiveMapImage(this, image, {
					renderReason,
					lastPathId: this.latestMapPathId,
					pathResetCount: this.liveMapPathResetCount,
					lastPoseUpdated: this.lastPoseUpdated,
					currentAreaCount: countLiveMapAreas20002(this.latestMapData),
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

	private waitForCommandConfirmation(command: RobotCommand): Promise<number | undefined> {
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

	private async setCommandFailure(stateId: string, command: RobotCommand, error: unknown): Promise<void> {
		const message = redactedErrorMessage(error);
		await this.setStateAsync("commands.lastCommand", { val: command, ack: true });
		await this.setStateAsync("commands.lastResult", { val: "failed", ack: true });
		await this.setStateAsync("commands.lastError", { val: message, ack: true });
		await this.setStateAsync("commands.lastExecution", { val: new Date().toISOString(), ack: true });
		await this.setStateAsync(stateId, { val: false, ack: true });
		this.log.warn(`Proscenic command ${command} failed: ${message}`);
	}

	private clearCommandSession(): void {
		this.commandEnabled = false;
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

		await this.deleteObsoleteLiveMapRoomColor();
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

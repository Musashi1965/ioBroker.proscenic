/*
 * Created with @iobroker/create-adapter v3.1.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from "@iobroker/adapter-core";
import {
	buildCommandRequest,
	commandForStateId,
	normalizeCommandButtonValue,
	type RobotCommand,
} from "./domain/commands";
import { normalizeMap20002 } from "./domain/map";
import { reconnectDelayMs } from "./domain/reconnect-policy";
import { normalizeStatus20001 } from "./domain/status";
import { extendAdapterObjects } from "./objects/object-definitions";
import {
	projectDevice,
	projectMapMetadata,
	projectStatus,
	redactedErrorMessage,
	setConnectionState,
	setInitialCapabilityStates,
	setLastError,
} from "./objects/projector";
import { ProscenicGatewayClient } from "./protocol/gateway-client";
import { ProscenicRestClient } from "./protocol/rest-client";
import type { DeviceRecord, GatewayData, GatewayEndpoint } from "./protocol/types";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_GATEWAY_BUFFER_BYTES = 512 * 1024;

class Proscenic extends utils.Adapter {
	private gatewayClient: ProscenicGatewayClient | undefined;
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private reconnectAttempt = 0;
	private reconnectInProgress = false;
	private commandInProgress = false;
	private commandEnabled = false;
	private commandClient: ProscenicRestClient | undefined;
	private commandToken: string | undefined;
	private commandSerial: string | undefined;
	private shuttingDown = false;

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
		await setConnectionState(this, "cloud", false);
		await setConnectionState(this, "gateway", false);
		await setInitialCapabilityStates(this);
		this.subscribeStates("commands.*");

		if (!this.config.username || !this.config.password) {
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
			await setConnectionState(this, "cloud", false);
			await setConnectionState(this, "gateway", false);
			this.log.warn(`Could not start Proscenic read-only connection: ${redactedErrorMessage(error)}`);
			this.scheduleReconnect("connection failure");
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
		await setConnectionState(this, "cloud", true);

		const devices = await client.listDevices();
		const device = selectDevice(devices, this.config.deviceCode);
		await projectDevice(this, device);

		if (!device.sn) {
			throw new Error("Selected device cannot be used because its protocol serial is missing");
		}
		this.commandSerial = device.sn;
		this.commandEnabled = isM7Pro(device);
		await this.setStateAsync("capabilities.commands", { val: this.commandEnabled, ack: true });

		const gateway = await client.getGateway(token, device.sn);
		const endpoint = selectGatewayEndpoint(gateway);

		this.gatewayClient?.destroy();
		this.gatewayClient = new ProscenicGatewayClient({
			endpoint,
			token,
			serial: device.sn,
			timeoutMs: DEFAULT_TIMEOUT_MS,
			maxBufferBytes: MAX_GATEWAY_BUFFER_BYTES,
			onConnect: () => {
				this.reconnectAttempt = 0;
				void setConnectionState(this, "gateway", true);
				this.log.info("Connected to the Proscenic gateway.");
			},
			onEvent: event => {
				void this.handleGatewayEvent(event.infoType, event.data);
			},
			onClose: () => {
				void setConnectionState(this, "gateway", false);
				if (!this.shuttingDown) {
					this.log.warn("Proscenic gateway connection closed.");
					this.scheduleReconnect("gateway close");
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

	private scheduleReconnect(reason: string): void {
		if (this.shuttingDown || this.reconnectTimer) {
			return;
		}

		this.reconnectAttempt += 1;
		const delayMs = reconnectDelayMs(this.reconnectAttempt);
		this.log.info(
			`Scheduling Proscenic gateway reconnect in ${Math.round(delayMs / 1_000)} seconds after ${reason}.`,
		);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			void this.connectReadOnlyGateway();
		}, delayMs);
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
	}

	private async handleGatewayEvent(infoType: unknown, data: unknown): Promise<void> {
		if (infoType === 20001) {
			const status = normalizeStatus20001(data);
			if (status) {
				await projectStatus(this, status);
			}
			return;
		}

		if (infoType === 20002) {
			const map = normalizeMap20002(data);
			if (map) {
				await projectMapMetadata(this, map);
			}
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

		void this.executeCommand(relativeId, command);
	}

	private relativeStateId(id: string): string {
		const prefix = `${this.namespace}.`;
		return id.startsWith(prefix) ? id.slice(prefix.length) : id;
	}

	private async executeCommand(stateId: string, command: RobotCommand): Promise<void> {
		if (this.commandInProgress) {
			await this.setCommandFailure(
				stateId,
				command,
				new Error("Another Proscenic command is already in progress"),
			);
			return;
		}

		this.commandInProgress = true;
		await this.setStateAsync("commands.lastCommand", { val: command, ack: true });
		await this.setStateAsync("commands.lastResult", { val: "running", ack: true });
		await this.setStateAsync("commands.lastError", { val: "", ack: true });
		await this.setStateAsync("commands.lastExecution", { val: new Date().toISOString(), ack: true });

		try {
			if (!this.commandClient || !this.commandToken || !this.commandSerial || !this.config.username) {
				throw new Error("Proscenic command session is not ready");
			}
			if (!this.commandEnabled) {
				throw new Error("Proscenic commands are not enabled for the selected device");
			}

			const request = buildCommandRequest(command, this.commandSerial, this.config.username);
			const result = await this.commandClient.sendCommand(this.commandToken, request);
			await this.setStateAsync("commands.lastResult", {
				val: result.code === undefined || result.code === 0 ? "sent" : `api-code-${result.code}`,
				ack: true,
			});
			await this.setStateAsync(stateId, { val: false, ack: true });
		} catch (error) {
			await this.setCommandFailure(stateId, command, error);
		} finally {
			this.commandInProgress = false;
		}
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

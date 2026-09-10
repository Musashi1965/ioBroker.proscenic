import { Socket } from "node:net";
import { decryptGatewayPayload, gatewayHandshake, parseJsonObject, splitFrames } from "./crypto";
import type { GatewayEndpoint, GatewayEvent } from "./types";

export interface GatewayClientOptions {
	endpoint: GatewayEndpoint;
	token: string;
	serial: string;
	timeoutMs: number;
	maxBufferBytes: number;
	onConnect: () => void;
	onEvent: (event: GatewayEvent) => void;
	onClose: () => void;
	onError: (error: Error) => void;
}

export class ProscenicGatewayClient {
	private readonly socket = new Socket();
	private buffer = "";
	private closed = false;

	public constructor(private readonly options: GatewayClientOptions) {}

	public connect(): void {
		this.socket.setTimeout(this.options.timeoutMs);
		this.socket.on("connect", () => {
			this.socket.setTimeout(0);
			this.socket.write(gatewayHandshake(this.options.token, this.options.serial), "utf8");
			this.options.onConnect();
		});
		this.socket.on("data", (chunk: Buffer) => this.handleData(chunk));
		this.socket.on("timeout", () => this.closeWithError(new Error("Gateway socket timeout")));
		this.socket.on("error", error => this.closeWithError(error));
		this.socket.on("close", () => this.close());
		this.socket.connect(this.options.endpoint.port, this.options.endpoint.host);
	}

	public destroy(): void {
		this.closed = true;
		this.socket.removeAllListeners();
		this.socket.destroy();
		this.buffer = "";
	}

	private handleData(chunk: Buffer): void {
		this.buffer += chunk.toString("utf8");
		if (Buffer.byteLength(this.buffer, "utf8") > this.options.maxBufferBytes) {
			this.closeWithError(new Error("Gateway buffer limit exceeded"));
			return;
		}

		const split = splitFrames(this.buffer);
		this.buffer = split.rest;

		for (const frame of split.frames) {
			if (frame.trim().length === 0) {
				continue;
			}

			const result = parseGatewayFrameResult(frame, this.options.token);
			if (result.error) {
				this.closeWithError(result.error);
				return;
			}

			const event = result.event;
			if (event) {
				this.options.onEvent(event);
			}
		}
	}

	private closeWithError(error: Error): void {
		if (!this.closed) {
			this.options.onError(error);
		}
		this.close();
	}

	private close(): void {
		if (this.closed) {
			return;
		}

		this.closed = true;
		this.socket.removeAllListeners();
		this.socket.destroy();
		this.buffer = "";
		this.options.onClose();
	}
}

export interface GatewayFrameParseResult {
	event?: GatewayEvent;
	error?: Error;
}

export function parseGatewayFrameResult(frame: string, token?: string): GatewayFrameParseResult {
	try {
		return {
			event: parseGatewayFrame(frame, token),
		};
	} catch (error) {
		return {
			error: error instanceof Error ? error : new Error(String(error)),
		};
	}
}

export function parseGatewayFrame(frame: string, token?: string): GatewayEvent | undefined {
	const envelope = parseJsonObject(frame);
	if (envelope.encrypt !== true && !("encrypt" in envelope)) {
		return {
			encrypted: false,
			infoType: envelope.infoType,
			data: envelope.data,
		};
	}

	if (typeof envelope.data !== "string") {
		return undefined;
	}

	if (!token) {
		return {
			encrypted: true,
		};
	}

	const decryptedText = decryptGatewayPayload(envelope.data, token);
	const decrypted = parseJsonObject(decryptedText);

	return {
		encrypted: true,
		infoType: decrypted.infoType,
		data: decrypted.data,
	};
}

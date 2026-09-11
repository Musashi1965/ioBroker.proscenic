import { request as httpsRequest } from "node:https";
import type { CommandRequest } from "../domain/commands";
import { md5Hex } from "./crypto";
import type { DeviceListData, DeviceRecord, GatewayData, LoginData, ProscenicEnvelope } from "./types";

const REGION_BASE_URLS = {
	eu: "https://mobile.proscenic.com.de",
} as const;

export type ProscenicRegion = keyof typeof REGION_BASE_URLS;

export interface ProscenicClientOptions {
	username: string;
	password: string;
	region: ProscenicRegion;
	timeoutMs: number;
}

export class ProscenicRestClient {
	private readonly baseUrl: URL;

	public constructor(private readonly options: ProscenicClientOptions) {
		this.baseUrl = new URL(REGION_BASE_URLS[options.region]);
	}

	public async login(): Promise<string> {
		const response = await this.postJson<LoginData>(
			"/user/login",
			{
				state: "欧洲",
				countryCode: "49",
				appVer: "1.7.8",
				type: "2",
				os: "IOS",
				password: md5Hex(this.options.password),
				registrationId: "13165ffa4eb156ac484",
				language: "EN",
				username: this.options.username,
				pwd: this.options.password,
			},
			{
				c: "338",
				lan: "en",
				os: "i",
				"User-Agent": "ProscenicHome/1.7.8",
				v: "1.7.8",
			},
		);

		if (!response.data?.token) {
			throw new Error("Login succeeded without token");
		}

		return response.data.token;
	}

	public async listDevices(): Promise<DeviceRecord[]> {
		const path = `/user/getEquips/${encodeURIComponent(this.options.username)}`;
		const response = await this.postForm<DeviceListData>(path, {
			username: this.options.username,
		});

		return response.data?.content ?? [];
	}

	public async getGateway(token: string, serial: string): Promise<GatewayData> {
		const response = await this.postForm<GatewayData>(
			"/appInit/getSockAddr",
			{
				username: this.options.username,
				sn: serial,
			},
			{
				token,
			},
		);

		return response.data ?? {};
	}

	public async sendCommand(token: string, command: CommandRequest): Promise<ProscenicEnvelope> {
		if (command.contentType) {
			return this.request(command.path, command.body, {
				"Content-Type": command.contentType,
				token,
			});
		}

		return this.postFormPath(command.path, command.body, { token });
	}

	private async postJson<T>(
		path: string,
		body: Record<string, unknown>,
		headers: Record<string, string> = {},
	): Promise<ProscenicEnvelope<T>> {
		return this.request<T>(path, JSON.stringify(body), {
			"Content-Type": "application/json",
			...headers,
		});
	}

	private async postForm<T>(
		path: string,
		body: Record<string, string>,
		headers: Record<string, string> = {},
	): Promise<ProscenicEnvelope<T>> {
		return this.postFormPath<T>(path, new URLSearchParams(body).toString(), headers);
	}

	private async postFormPath<T>(
		path: string,
		body: string,
		headers: Record<string, string> = {},
	): Promise<ProscenicEnvelope<T>> {
		return this.request<T>(path, body, {
			"Content-Type": "application/x-www-form-urlencoded",
			...headers,
		});
	}

	private async request<T>(
		path: string,
		body: string,
		headers: Record<string, string>,
	): Promise<ProscenicEnvelope<T>> {
		const url = new URL(path, this.baseUrl);

		return new Promise((resolve, reject) => {
			const rejectWithError = (error: unknown): void => {
				reject(error instanceof Error ? error : new Error(String(error)));
			};
			const context: { timer?: NodeJS.Timeout } = {};
			const req = httpsRequest(
				url,
				{
					method: "POST",
					timeout: this.options.timeoutMs,
					headers: {
						"Content-Length": Buffer.byteLength(body).toString(),
						...headers,
					},
				},
				res => {
					const chunks: Buffer[] = [];
					res.on("data", (chunk: Buffer) => chunks.push(chunk));
					res.on("end", () => {
						if (context.timer) {
							clearTimeout(context.timer);
						}
						const text = Buffer.concat(chunks).toString("utf8");
						try {
							const parsed = JSON.parse(text) as ProscenicEnvelope<T>;
							if (res.statusCode !== 200) {
								rejectWithError(new Error(`HTTP ${res.statusCode ?? "unknown"}`));
								return;
							}
							if (parsed.code !== undefined && parsed.code !== 0) {
								rejectWithError(new Error(parsed.errorMsg || parsed.msg || `API code ${parsed.code}`));
								return;
							}
							resolve(parsed);
						} catch (error) {
							rejectWithError(error);
						}
					});
				},
			);

			context.timer = setTimeout(() => {
				req.destroy(new Error(`Request timed out after ${this.options.timeoutMs} ms`));
			}, this.options.timeoutMs);

			req.on("error", error => {
				if (context.timer) {
					clearTimeout(context.timer);
				}
				rejectWithError(error);
			});
			req.write(body);
			req.end();
		});
	}
}

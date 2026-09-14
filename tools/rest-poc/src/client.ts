import { request as httpsRequest } from "node:https";
import type { DeviceListData, DeviceRecord, LoginData, ProscenicEnvelope } from "./protocol.js";
import { md5Hex } from "./protocol.js";

const REGION_BASE_URLS = {
  eu: "https://mobile.proscenic.com.de",
  tw: "https://mobile.proscenic.tw",
} as const;

export type Region = keyof typeof REGION_BASE_URLS;

export interface ClientOptions {
  email: string;
  password: string;
  region: Region;
  timeoutMs: number;
  baseUrl?: string;
}

export interface ProbeRequest {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface ProbeResponse {
  statusCode: number | undefined;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  json: unknown | undefined;
}

export class ProscenicRestProbeClient {
  private readonly baseUrl: URL;

  public constructor(private readonly options: ClientOptions) {
    this.baseUrl = new URL(options.baseUrl ?? REGION_BASE_URLS[options.region]);
  }

  public async login(): Promise<string> {
    const response = await this.postJson<LoginData>("/user/login", {
      state: "欧洲",
      countryCode: "49",
      appVer: "1.7.8",
      type: "2",
      os: "IOS",
      password: md5Hex(this.options.password),
      registrationId: "13165ffa4eb156ac484",
      language: "EN",
      username: this.options.email,
      pwd: this.options.password,
    }, {
      c: "338",
      lan: "en",
      os: "i",
      "User-Agent": "ProscenicHome/1.7.8",
      v: "1.7.8",
    });

    if (!response.data?.token) {
      throw new Error("Login succeeded without token");
    }

    return response.data.token;
  }

  public async listDevices(): Promise<DeviceRecord[]> {
    const path = `/user/getEquips/${encodeURIComponent(this.options.email)}`;
    const response = await this.postForm<DeviceListData>(path, {
      username: this.options.email,
    });

    return response.data?.content ?? [];
  }

  public async probe(request: ProbeRequest): Promise<ProbeResponse> {
    const body = request.method === "POST"
      ? new URLSearchParams(request.body ?? {}).toString()
      : undefined;
    const headers = request.method === "POST"
      ? {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body ?? "").toString(),
          ...(request.headers ?? {}),
        }
      : request.headers ?? {};

    return this.rawRequest({
      method: request.method,
      path: request.path,
      body,
      headers,
    });
  }

  private async postJson<T>(
    path: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): Promise<ProscenicEnvelope<T>> {
    const response = await this.rawRequest({
      method: "POST",
      path,
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(JSON.stringify(body)).toString(),
        ...headers,
      },
    });
    return parseEnvelope<T>(response);
  }

  private async postForm<T>(
    path: string,
    body: Record<string, string>,
    headers: Record<string, string> = {},
  ): Promise<ProscenicEnvelope<T>> {
    const encodedBody = new URLSearchParams(body).toString();
    const response = await this.rawRequest({
      method: "POST",
      path,
      body: encodedBody,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(encodedBody).toString(),
        ...headers,
      },
    });
    return parseEnvelope<T>(response);
  }

  private async rawRequest(options: {
    method: "GET" | "POST";
    path: string;
    body?: string;
    headers: Record<string, string>;
  }): Promise<ProbeResponse> {
    const url = new URL(options.path, this.baseUrl);

    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          method: options.method,
          timeout: this.options.timeoutMs,
          headers: options.headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            clearTimeout(timer);
            const text = Buffer.concat(chunks).toString("utf8");
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              text,
              json: parseJsonSafely(text),
            });
          });
        },
      );

      const timer = setTimeout(() => {
        req.destroy(new Error(`Request timed out after ${this.options.timeoutMs} ms`));
      }, this.options.timeoutMs);

      req.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      if (options.body !== undefined) {
        req.write(options.body);
      }
      req.end();
    });
  }
}

function parseEnvelope<T>(response: ProbeResponse): ProscenicEnvelope<T> {
  if (response.statusCode !== 200) {
    throw new Error(`HTTP ${response.statusCode ?? "unknown"}`);
  }
  const parsed = response.json as ProscenicEnvelope<T> | undefined;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Expected JSON response");
  }
  if (parsed.code !== undefined && parsed.code !== 0) {
    throw new Error(parsed.errorMsg || parsed.msg || `API code ${parsed.code}`);
  }
  return parsed;
}

function parseJsonSafely(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

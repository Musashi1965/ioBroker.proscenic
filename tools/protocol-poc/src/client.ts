import { request as httpRequest } from "node:https";
import type {
  DeviceListData,
  DeviceRecord,
  GatewayData,
  LoginData,
  ProscenicEnvelope,
} from "./protocol.js";
import { md5Hex } from "./protocol.js";

const REGION_BASE_URLS = {
  eu: "https://mobile.proscenic.com.de",
} as const;

export type Region = keyof typeof REGION_BASE_URLS;

export interface ClientOptions {
  email: string;
  password: string;
  region: Region;
  timeoutMs: number;
}

export class ProscenicClient {
  private readonly baseUrl: URL;

  public constructor(private readonly options: ClientOptions) {
    this.baseUrl = new URL(REGION_BASE_URLS[options.region]);
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

  public async getGateway(token: string, serial: string): Promise<GatewayData> {
    const response = await this.postForm<GatewayData>(
      "/appInit/getSockAddr",
      {
        username: this.options.email,
        sn: serial,
      },
      {
        token,
      },
    );

    return response.data ?? {};
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
    return this.request<T>(path, new URLSearchParams(body).toString(), {
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
      const timer = setTimeout(() => {
        req.destroy(new Error(`Request timed out after ${this.options.timeoutMs} ms`));
      }, this.options.timeoutMs);

      const req = httpRequest(
        url,
        {
          method: "POST",
          timeout: this.options.timeoutMs,
          headers: {
            "Content-Length": Buffer.byteLength(body).toString(),
            ...headers,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            clearTimeout(timer);
            const text = Buffer.concat(chunks).toString("utf8");
            try {
              const parsed = JSON.parse(text) as ProscenicEnvelope<T>;
              if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode ?? "unknown"}`));
                return;
              }
              if (parsed.code !== undefined && parsed.code !== 0) {
                reject(new Error(parsed.errorMsg || parsed.msg || `API code ${parsed.code}`));
                return;
              }
              resolve(parsed);
            } catch (error) {
              reject(error);
            }
          });
        },
      );

      req.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      req.write(body);
      req.end();
    });
  }
}

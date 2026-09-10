import { createDecipheriv, createHash } from "node:crypto";

export const FRAME_DELIMITER = "#\t#";

export interface ProscenicEnvelope<T = unknown> {
  code?: number;
  msg?: string;
  errorMsg?: string;
  data?: T;
}

export interface LoginData {
  token: string;
}

export interface DeviceRecord {
  code?: string;
  model?: string;
  name?: string;
  sn?: string;
  status?: boolean;
}

export interface DeviceListData {
  content?: DeviceRecord[];
}

export interface GatewayAddress {
  ip?: string;
  port?: number | string;
}

export interface GatewayData {
  addr_list?: GatewayAddress[];
}

export function md5Hex(value: string): string {
  return createHash("md5").update(value, "utf8").digest("hex");
}

export function gatewayHandshake(token: string, serial: string): string {
  return JSON.stringify({
    data: {
      token,
      sn: serial,
    },
    infoType: 70001,
  }) + FRAME_DELIMITER;
}

export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer;

  for (;;) {
    const index = rest.indexOf(FRAME_DELIMITER);
    if (index === -1) {
      return { frames, rest };
    }

    frames.push(rest.slice(0, index));
    rest = rest.slice(index + FRAME_DELIMITER.length);
  }
}

export function decryptGatewayPayload(base64Payload: string, token: string): string {
  const key = Buffer.from(token, "utf8");
  if (![16, 24, 32].includes(key.length)) {
    throw new Error(`Unsupported AES key length ${key.length}`);
  }

  const decipher = createDecipheriv(`aes-${key.length * 8}-ecb`, key, null);
  decipher.setAutoPadding(true);

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(base64Payload, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8").replace(/\0+$/u, "");
}

export function parseJsonObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object");
  }

  return parsed as Record<string, unknown>;
}

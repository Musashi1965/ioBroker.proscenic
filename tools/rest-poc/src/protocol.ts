import { createHash } from "node:crypto";

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

export function md5Hex(value: string): string {
  return createHash("md5").update(value, "utf8").digest("hex");
}

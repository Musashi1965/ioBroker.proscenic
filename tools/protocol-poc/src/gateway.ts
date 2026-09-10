import { Socket } from "node:net";
import { decryptGatewayPayload, gatewayHandshake, parseJsonObject, splitFrames } from "./protocol.js";

export interface GatewayEndpoint {
  host: string;
  port: number;
}

export interface GatewayEvent {
  encrypted: boolean;
  infoType?: unknown;
  decrypted?: Record<string, unknown>;
}

export type GatewayProbeCompletionReason =
  | "listen-window-elapsed"
  | "max-events-reached"
  | "socket-timeout"
  | "socket-closed";

export interface GatewayProbeResult {
  events: GatewayEvent[];
  completionReason: GatewayProbeCompletionReason;
  elapsedMs: number;
}

export interface GatewayProbeOptions {
  endpoint: GatewayEndpoint;
  token: string;
  serial: string;
  listenSeconds: number;
  maxEvents: number;
  timeoutMs: number;
  maxBufferBytes: number;
}

export async function readGatewayEvents(options: GatewayProbeOptions): Promise<GatewayProbeResult> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const events: GatewayEvent[] = [];
    let buffer = "";
    let settled = false;
    let connected = false;
    const startedAt = Date.now();

    const finish = (completionReason: GatewayProbeCompletionReason, error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(listenTimer);
      socket.removeAllListeners();
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve({
          events,
          completionReason,
          elapsedMs: Date.now() - startedAt,
        });
      }
    };

    const connectTimer = setTimeout(() => {
      finish(
        "socket-timeout",
        new Error(`Gateway connection timed out after ${options.timeoutMs} ms`),
      );
    }, options.timeoutMs);

    const listenTimer = setTimeout(() => {
      finish("listen-window-elapsed");
    }, options.listenSeconds * 1000);

    socket.setTimeout(options.timeoutMs);
    socket.on("connect", () => {
      connected = true;
      clearTimeout(connectTimer);
      socket.setTimeout(0);
      socket.write(gatewayHandshake(options.token, options.serial), "utf8");
    });

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer, "utf8") > options.maxBufferBytes) {
        finish("socket-closed", new Error("Gateway buffer limit exceeded"));
        return;
      }

      const split = splitFrames(buffer);
      buffer = split.rest;

      for (const frame of split.frames) {
        if (frame.trim().length === 0) {
          continue;
        }

        const event = parseGatewayFrame(frame, options.token);
        if (event) {
          events.push(event);
        }

        if (events.length >= options.maxEvents) {
          finish("max-events-reached");
          return;
        }
      }
    });

    socket.on("timeout", () => finish("socket-timeout"));
    socket.on("error", (error) => {
      if (connected) {
        finish("socket-closed");
      } else {
        finish("socket-closed", error);
      }
    });
    socket.on("close", () => finish("socket-closed"));
    socket.connect(options.endpoint.port, options.endpoint.host);
  });
}

export function parseGatewayFrame(frame: string, token?: string): GatewayEvent | undefined {
  const envelope = parseJsonObject(frame);
  if (envelope.encrypt !== true && !("encrypt" in envelope)) {
    return {
      encrypted: false,
      infoType: envelope.infoType,
      decrypted: envelope,
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
    decrypted,
  };
}

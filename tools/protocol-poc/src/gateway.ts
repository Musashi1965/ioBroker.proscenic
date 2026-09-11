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

export interface GatewayFrameError {
  message: string;
}

export type GatewayProbeCompletionReason =
  | "listen-window-elapsed"
  | "max-events-reached"
  | "socket-timeout"
  | "socket-closed";

export interface GatewayProbeResult {
  events: GatewayEvent[];
  frameErrors: GatewayFrameError[];
  completionReason: GatewayProbeCompletionReason;
  elapsedMs: number;
}

export interface GatewayProbeOptions {
  endpoint: GatewayEndpoint;
  token: string;
  tokenCandidates?: string[];
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
    const frameErrors: GatewayFrameError[] = [];
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
          frameErrors,
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

        const result = parseGatewayFrameResult(frame, tokenCandidates(options.token, options.tokenCandidates));
        if (result.error) {
          frameErrors.push({
            message: safeFrameErrorMessage(result.error),
          });
          continue;
        }

        if (result.event) {
          events.push(result.event);
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

export interface GatewayFrameParseResult {
  event?: GatewayEvent;
  error?: Error;
}

export function parseGatewayFrameResult(frame: string, token?: string | string[]): GatewayFrameParseResult {
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

export function parseGatewayFrame(frame: string, token?: string | string[]): GatewayEvent | undefined {
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

  const tokens = Array.isArray(token) ? token : token ? [token] : [];
  if (tokens.length === 0) {
    return {
      encrypted: true,
    };
  }

  const decrypted = decryptWithTokenCandidates(envelope.data, tokens);

  return {
    encrypted: true,
    infoType: decrypted.infoType,
    decrypted,
  };
}

function decryptWithTokenCandidates(base64Payload: string, tokens: string[]): Record<string, unknown> {
  let lastError: unknown;

  for (const token of tokens) {
    try {
      const decryptedText = decryptGatewayPayload(base64Payload, token);
      return parseJsonObject(decryptedText);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function tokenCandidates(currentToken: string, additionalTokens: string[] | undefined): string[] {
  return [...new Set([currentToken, ...(additionalTokens ?? [])])];
}

function safeFrameErrorMessage(error: Error): string {
  if (error.message.includes("bad decrypt") || error.message.includes("wrong final block length")) {
    return "decrypt failed";
  }
  if (error.message.includes("Unexpected") || error.message.includes("JSON")) {
    return "json parse failed";
  }

  return error.message
    .replace(/[A-Za-z0-9+/=]{24,}/gu, "<redacted-blob>")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu, "<redacted-email>")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/gu, "<redacted-address>");
}

import { createCipheriv } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readGatewayEvents, parseGatewayFrame } from "./gateway.js";
import type { AddressInfo } from "node:net";
import { createServer } from "node:net";

describe("gateway frame parser", () => {
  it("decrypts encrypted gateway frames when a token is available", () => {
    const token = "0123456789abcdef";
    const plaintext = JSON.stringify({
      infoType: 20001,
      data: {
        cleanState: 1,
      },
    });
    const cipher = createCipheriv("aes-128-ecb", Buffer.from(token), null);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]).toString("base64");

    assert.deepEqual(parseGatewayFrame(JSON.stringify({
      encrypt: true,
      data: encrypted,
    }), token), {
      encrypted: true,
      infoType: 20001,
      decrypted: {
        infoType: 20001,
        data: {
          cleanState: 1,
        },
      },
    });
  });
});

describe("gateway reader", () => {
  it("waits for the listen window after connecting when no frames arrive", async () => {
    const server = createServer((socket) => {
      socket.on("data", () => {
        // Keep the connection open until the client-side listen window elapses.
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      assert.equal(typeof address, "object");
      assert.ok(address);
      const { port } = address as AddressInfo;
      const result = await readGatewayEvents({
        endpoint: {
          host: "127.0.0.1",
          port,
        },
        token: "0123456789abcdef",
        serial: "serial",
        listenSeconds: 1,
        maxEvents: 1,
        timeoutMs: 100,
        maxBufferBytes: 1024,
      });

      assert.equal(result.completionReason, "listen-window-elapsed");
      assert.equal(result.events.length, 0);
      assert.ok(result.elapsedMs >= 900);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("reports socket-closed when the gateway closes immediately", async () => {
    const server = createServer((socket) => {
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      assert.equal(typeof address, "object");
      assert.ok(address);
      const { port } = address as AddressInfo;
      const result = await readGatewayEvents({
        endpoint: {
          host: "127.0.0.1",
          port,
        },
        token: "0123456789abcdef",
        serial: "serial",
        listenSeconds: 10,
        maxEvents: 1,
        timeoutMs: 100,
        maxBufferBytes: 1024,
      });

      assert.equal(result.completionReason, "socket-closed");
      assert.equal(result.events.length, 0);
      assert.ok(result.elapsedMs < 1_000);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});

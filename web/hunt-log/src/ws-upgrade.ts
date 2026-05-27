// BFF WebSocket upgrade for /api/session.
//
// Per-browser flow: validate the CF Access JWT (production only), accept the
// WebSocket upgrade, open a fresh `GatewayClient` to the local OpenClaw
// Gateway, then pipe frames in both directions. Translation between the
// browser ClientFrame protocol and Gateway requests lives inside `send()`
// on the gateway client (see ./lib/gateway/client.ts).
//
// Relative imports (no `$lib` alias) so the postbuild tsc step can compile
// this file directly into build/ without needing the SvelteKit-generated
// tsconfig.

import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import { verifyAccessJwt } from "./lib/auth/access.js";
import { connectGateway, type GatewayClient } from "./lib/gateway/client.js";
import { decodeFrame, encodeFrame, isClientFrame } from "./lib/gateway/frames.js";

const wss = new WebSocketServer({ noServer: true });

export function attachWsUpgrade(server: Server): void {
  server.on("upgrade", async (request, socket, head) => {
    if (!request.url?.startsWith("/api/session")) {
      socket.destroy();
      return;
    }

    // Dev bypass: skip CF Access unless explicitly enforced.
    const isDev = process.env.NODE_ENV !== "production" && process.env.FORCE_AUTH !== "1";
    if (!isDev) {
      const jwt = request.headers["cf-access-jwt-assertion"];
      if (typeof jwt !== "string" || !jwt) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      try {
        await verifyAccessJwt(jwt);
      } catch (e) {
        socket.write(`HTTP/1.1 403 Forbidden\r\n\r\nJWT verify failed: ${(e as Error).message}`);
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, async (ws) => {
      let gw: GatewayClient | null = null;
      try {
        gw = await connectGateway();
      } catch (e) {
        if (ws.readyState === ws.OPEN) {
          ws.send(
            encodeFrame({
              type: "error",
              code: "GATEWAY_UNAVAILABLE",
              message: (e as Error).message ?? String(e),
            }),
          );
          ws.close();
        }
        return;
      }

      gw.onEvent((frame) => {
        if (ws.readyState === ws.OPEN) ws.send(encodeFrame(frame));
      });
      gw.onClose(() => {
        if (ws.readyState === ws.OPEN) {
          ws.send(
            encodeFrame({
              type: "error",
              code: "GATEWAY_DISCONNECTED",
              message: "gateway closed",
            }),
          );
          ws.close();
        }
      });

      ws.on("message", (data) => {
        const raw = Buffer.isBuffer(data)
          ? data.toString("utf8")
          : Array.isArray(data)
            ? Buffer.concat(data as Buffer[]).toString("utf8")
            : data.toString();
        let frame;
        try {
          frame = decodeFrame(raw);
        } catch (e) {
          if (ws.readyState === ws.OPEN) {
            ws.send(
              encodeFrame({ type: "error", code: "BAD_FRAME", message: (e as Error).message }),
            );
          }
          return;
        }
        if (!isClientFrame(frame)) return;
        gw?.send(frame);
      });

      ws.on("close", () => {
        gw?.close();
      });
    });
  });
}

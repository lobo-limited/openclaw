// Server-only OpenClaw Gateway WebSocket client (Hunt Log BFF).
//
// The Hunt Log browser talks to a SvelteKit BFF over its own WebSocket
// protocol (see ./frames.ts). This module is the *other half*: the BFF's
// outbound connection to the local OpenClaw Gateway at ws://127.0.0.1:18789.
//
// Source of truth for wire shapes: ../../docs/gateway-frames.md (wire-captured
// from the live Gateway). The OpenClaw client source that authored the captures
// lives at /home/lrjhr/.npm-global/lib/node_modules/openclaw/dist/.
//
// Responsibilities:
//   1. Open the WS, wait for the unsolicited `connect.challenge` nonce.
//   2. Build the ed25519-signed device-identity connect block, send `req`
//      `method: "connect"`, await the `hello-ok` `res`.
//   3. Expose `send` / `onEvent` / `onClose` / `close` so the BFF (Task 13)
//      can pipe browser frames through.
//   4. Project raw Gateway events into the ServerFrame protocol the browser
//      consumes (`mapGatewayEvent` + the run-scoped factory).
//
// Identity policy for v0: reuse the CLI's device identity at
// `~/.openclaw/identity/device.json` + `device-auth.json`. Task 17 will pair
// a dedicated BFF identity later.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { WebSocket } from "ws";
import type { ClientFrame, ServerFrame } from "./frames";

// ===========================================================================
// Configuration
// ===========================================================================

const GATEWAY_URL = process.env.GATEWAY_URL ?? "ws://127.0.0.1:18789";
const IDENTITY_DIR =
  process.env.OPENCLAW_IDENTITY_DIR ?? path.join(homedir(), ".openclaw", "identity");
const CONNECT_TIMEOUT_MS = 10_000;
const CLIENT_VERSION = "0.0.1";
const CLIENT_NAME = "gateway-client"; // matches GATEWAY_CLIENT_IDS.GATEWAY_CLIENT
const CLIENT_MODE = "backend"; // matches GATEWAY_CLIENT_MODES.BACKEND
const DEFAULT_ROLE = "operator";
const DEFAULT_SCOPES = ["operator.admin"];

// ===========================================================================
// Public types
// ===========================================================================

export interface GatewayClient {
  /** Send a browser-side ClientFrame; the BFF/Task 13 owns translation. */
  send(frame: ClientFrame): void;
  onEvent(handler: (event: ServerFrame) => void): void;
  onClose(handler: () => void): void;
  close(): void;
}

export type { ServerFrame };

// ===========================================================================
// Device identity loading
// ===========================================================================

interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

interface DeviceAuthEntry {
  token: string;
  role: string;
  scopes: string[];
}

interface LoadedIdentity {
  identity: DeviceIdentity;
  auth: DeviceAuthEntry | null;
}

function loadDeviceIdentity(dir: string = IDENTITY_DIR): LoadedIdentity {
  const idPath = path.join(dir, "device.json");
  const authPath = path.join(dir, "device-auth.json");
  let raw: string;
  try {
    raw = fs.readFileSync(idPath, "utf8");
  } catch (e) {
    throw new Error(
      `Gateway client: device identity not found at ${idPath}. ` +
        `Pair the BFF with \`openclaw pair\` or set OPENCLAW_IDENTITY_DIR. (${(e as Error).message})`,
    );
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const deviceId = parsed.deviceId;
  const publicKeyPem = parsed.publicKeyPem;
  const privateKeyPem = parsed.privateKeyPem;
  if (
    typeof deviceId !== "string" ||
    typeof publicKeyPem !== "string" ||
    typeof privateKeyPem !== "string"
  ) {
    throw new Error(`Gateway client: malformed device identity at ${idPath}`);
  }
  const identity: DeviceIdentity = { deviceId, publicKeyPem, privateKeyPem };

  let auth: DeviceAuthEntry | null = null;
  try {
    const authRaw = fs.readFileSync(authPath, "utf8");
    const parsedAuth = JSON.parse(authRaw) as {
      deviceId?: string;
      tokens?: Record<string, { token?: unknown; role?: unknown; scopes?: unknown }>;
    };
    if (parsedAuth.deviceId === deviceId && parsedAuth.tokens) {
      const entry = parsedAuth.tokens[DEFAULT_ROLE];
      if (
        entry &&
        typeof entry.token === "string" &&
        typeof entry.role === "string" &&
        Array.isArray(entry.scopes) &&
        entry.scopes.every((s): s is string => typeof s === "string")
      ) {
        auth = { token: entry.token, role: entry.role, scopes: entry.scopes };
      }
    }
  } catch {
    // device-auth.json may not exist yet (first-time pairing flow); not fatal.
  }
  return { identity, auth };
}

// ===========================================================================
// Canonical signing payload (mirrors buildDeviceAuthPayloadV3 in OpenClaw dist)
// Format: v3 | deviceId | clientId | clientMode | role | scopes.join(",")
//         | String(signedAtMs) | token? | nonce | platform | deviceFamily?
// ===========================================================================

export interface DeviceAuthPayloadInput {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce: string;
  platform: string;
  deviceFamily?: string;
}

/** Trim + ASCII-lowercase. Matches `normalizeDeviceMetadataForAuth`. */
function normalizeMetadataForAuth(value: string | undefined): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

export function buildDeviceAuthSigningPayload(input: DeviceAuthPayloadInput): string {
  const scopes = input.scopes.join(",");
  const token = input.token ?? "";
  const platform = normalizeMetadataForAuth(input.platform);
  const deviceFamily = normalizeMetadataForAuth(input.deviceFamily);
  return [
    "v3",
    input.deviceId,
    input.clientId,
    input.clientMode,
    input.role,
    scopes,
    String(input.signedAtMs),
    token,
    input.nonce,
    platform,
    deviceFamily,
  ].join("|");
}

/** Base64url-encode a Buffer (no +/, no = padding). */
function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

/** Derive the raw 32-byte ed25519 public key from an SPKI PEM, base64url-encoded. */
const ED25519_SPKI_PREFIX_LEN = 12; // 302a300506032b6570032100

export function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  const der = spki as Buffer;
  // Strip SPKI prefix if present (length 12), otherwise emit the whole DER.
  const raw =
    der.length === ED25519_SPKI_PREFIX_LEN + 32 ? der.subarray(ED25519_SPKI_PREFIX_LEN) : der;
  return base64UrlEncode(raw);
}

function signWithPrivateKeyPem(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  // ed25519: hash algorithm MUST be null (PureEdDSA)
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, "utf8"), key));
}

// ===========================================================================
// ClientFrame -> Gateway request translation (pure, unit-testable)
// ===========================================================================

export interface GatewayRequest {
  type: "req";
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface TranslateContext {
  /** Most recent open approval id, captured when a `decision-required`
   * projection emerges. Used to resolve `decision` browser frames. */
  lastApprovalId: string | null;
  newId: () => string;
}

/**
 * Translate a browser ClientFrame into a Gateway request envelope (or null
 * when the frame has no immediate gateway-side effect — e.g. a `decision`
 * arriving with no open approval).
 *
 * Separate from `send()` so unit tests don't need to build a live WS.
 */
export function translateClientFrame(
  frame: ClientFrame,
  ctx: TranslateContext,
): GatewayRequest | null {
  if (frame.type === "begin") {
    return {
      type: "req",
      id: ctx.newId(),
      method: "agent",
      params: {
        message: frame.brief,
        agentId: "ops",
        idempotencyKey: ctx.newId(),
      },
    };
  }
  if (frame.type === "interrupt") {
    return {
      type: "req",
      id: ctx.newId(),
      method: "chat.abort",
      params: {},
    };
  }
  if (frame.type === "decision") {
    if (!ctx.lastApprovalId) return null;
    // v0: `edit` collapses to `reject` (no edits path yet).
    const decision = frame.action === "edit" ? "reject" : frame.action;
    return {
      type: "req",
      id: ctx.newId(),
      method: "exec.approval.resolve",
      params: { id: ctx.lastApprovalId, decision },
    };
  }
  return null;
}

// ===========================================================================
// Event projection (Gateway wire → ServerFrame)
// ===========================================================================

interface GatewayEventMapper {
  map(raw: unknown): ServerFrame | null;
}

/** Factory: holds per-runId state to distinguish first-assistant trace vs delta. */
export function createGatewayEventMapper(): GatewayEventMapper {
  const repliesStarted = new Set<string>();
  let toolCounter = 0;

  return {
    map(raw: unknown): ServerFrame | null {
      if (!raw || typeof raw !== "object") return null;
      const frame = raw as Record<string, unknown>;
      const t = frame.type;

      // Drop handshake artifacts
      if (t === "hello-ok") return null;

      // Terminal response to the original `agent` req
      if (t === "res") {
        const ok = frame.ok === true;
        const payload = (frame.payload ?? {}) as Record<string, unknown>;
        if (ok) {
          const status = typeof payload.status === "string" ? payload.status : null;
          if (status === "accepted") return null; // immediate ack, not user-visible
          const summary = typeof payload.summary === "string" ? payload.summary : "";
          if (status === "ok") return { type: "final", outcome: "applied", summary };
          if (status === "aborted") return { type: "final", outcome: "rejected", summary };
          if (status === "timeout") return { type: "final", outcome: "timeout", summary };
          return null;
        }
        const err = (frame.error ?? {}) as Record<string, unknown>;
        return {
          type: "error",
          code: typeof err.code === "string" ? err.code : "GATEWAY_ERROR",
          message: typeof err.message === "string" ? err.message : "",
        };
      }

      if (t !== "event") return null;
      const eventName = frame.event;
      if (typeof eventName !== "string") return null;
      const payload = (frame.payload ?? {}) as Record<string, unknown>;

      // ----- Approval surfaces -----
      if (eventName === "exec.approval.requested" || eventName === "plugin.approval.requested") {
        const id = typeof payload.id === "string" ? payload.id : "";
        if (!id) return null;
        const request = (payload.request ?? {}) as Record<string, unknown>;
        const files = extractApprovalFiles(request);
        const notes = extractApprovalNotes(request);
        return { type: "decision-required", plateId: id, proposal: { files, notes } };
      }

      // ----- Agent stream -----
      if (eventName === "agent") {
        const stream = typeof payload.stream === "string" ? payload.stream : null;
        const data = (payload.data ?? {}) as Record<string, unknown>;
        const runId = typeof payload.runId === "string" ? payload.runId : null;
        const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : null;
        const payloadSeq = typeof payload.seq === "number" ? payload.seq : 0;
        if (!stream || !runId) return null;

        if (stream === "lifecycle") {
          if (data.phase === "start") {
            return {
              type: "session",
              id: sessionKey ?? runId,
              createdAt: new Date().toISOString(),
            };
          }
          // phase=end is informational; the terminal `res` is the user-visible "done".
          return null;
        }

        if (stream === "plan") {
          return {
            type: "trace",
            kind: "plan",
            id: `${runId}:plan:${payloadSeq}`,
            data: { ...data },
          };
        }

        if (stream === "tool") {
          toolCounter += 1;
          return {
            type: "trace",
            kind: "specimen",
            id: `${runId}:tool:${payloadSeq || toolCounter}`,
            data: { ...data, startedAt: Date.now() },
          };
        }

        if (stream === "assistant") {
          const replyId = `${runId}:reply`;
          if (!repliesStarted.has(runId)) {
            repliesStarted.add(runId);
            return { type: "trace", kind: "reply", id: replyId, data: { text: "" } };
          }
          const delta =
            typeof data.delta === "string"
              ? data.delta
              : typeof data.text === "string"
                ? data.text
                : "";
          return { type: "delta", traceId: replyId, text: delta };
        }

        // thinking / item / approval / command_output / patch / usage / error etc.
        return null;
      }

      // ----- Chat stream -----
      if (eventName === "chat") {
        const state = typeof payload.state === "string" ? payload.state : null;
        const runId = typeof payload.runId === "string" ? payload.runId : null;
        if (!state || !runId) return null;
        const replyId = `${runId}:reply`;

        if (state === "delta") {
          const deltaText = typeof payload.deltaText === "string" ? payload.deltaText : "";
          if (!repliesStarted.has(runId)) {
            repliesStarted.add(runId);
            return { type: "trace", kind: "reply", id: replyId, data: { text: "" } };
          }
          return { type: "delta", traceId: replyId, text: deltaText };
        }

        if (state === "final") {
          return { type: "complete", traceId: replyId };
        }

        if (state === "error") {
          const errorKind = typeof payload.errorKind === "string" ? payload.errorKind : null;
          const errorMessage = typeof payload.errorMessage === "string" ? payload.errorMessage : "";
          return { type: "error", code: errorKind ?? "CHAT_ERROR", message: errorMessage };
        }

        if (state === "aborted") {
          const stopReason = typeof payload.stopReason === "string" ? payload.stopReason : "";
          return { type: "error", code: "ABORTED", message: stopReason };
        }

        return null;
      }

      // ----- Everything else: tick, health, presence, sessions.changed,
      //       voicewake.*, update.available, shutdown, heartbeat, cron,
      //       node.pair.*, device.pair.*, talk.*, session.*, connect.challenge,
      //       exec.approval.resolved, plugin.approval.resolved, unknown names.
      return null;
    },
  };
}

/**
 * Pure-ish front door: every call gets a fresh mapper, so the
 * first-vs-subsequent assistant rule resets per invocation. The live
 * Gateway client uses `createGatewayEventMapper()` directly so the rule
 * holds across the run.
 */
export function mapGatewayEvent(raw: unknown): ServerFrame | null {
  return createGatewayEventMapper().map(raw);
}

function extractApprovalFiles(request: Record<string, unknown>): Array<{
  name: string;
  hunks: string;
}> {
  const files = request.files;
  if (!Array.isArray(files)) return [];
  const out: Array<{ name: string; hunks: string }> = [];
  for (const f of files) {
    if (!f || typeof f !== "object") continue;
    const rec = f as Record<string, unknown>;
    if (typeof rec.name !== "string" || typeof rec.hunks !== "string") continue;
    out.push({ name: rec.name, hunks: rec.hunks });
  }
  return out;
}

function extractApprovalNotes(request: Record<string, unknown>): string[] {
  const notes = request.notes;
  if (!Array.isArray(notes)) return [];
  return notes.filter((n): n is string => typeof n === "string");
}

// ===========================================================================
// WebSocket dance: open → challenge → connect → hello-ok → ready
// ===========================================================================

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  expectFinal: boolean;
}

export async function connectGateway(): Promise<GatewayClient> {
  const { identity, auth } = loadDeviceIdentity();
  const scopes = auth?.scopes ?? DEFAULT_SCOPES;
  const deviceToken = auth?.token;

  const ws = new WebSocket(GATEWAY_URL);
  ws.binaryType = "nodebuffer";

  const pending = new Map<string, PendingRequest>();
  const eventHandlers: Array<(e: ServerFrame) => void> = [];
  const closeHandlers: Array<() => void> = [];
  const mapper = createGatewayEventMapper();
  let nonce: string | null = null;
  let helloReceived = false;
  // Task 13: track the most recent open approval id so the browser `decision`
  // frame can resolve it via exec.approval.resolve. Captured when a
  // `decision-required` projection emerges from the mapper.
  let lastApprovalId: string | null = null;

  const cleanupTimers: NodeJS.Timeout[] = [];
  const clearAllTimers = () => {
    for (const t of cleanupTimers) clearTimeout(t);
    cleanupTimers.length = 0;
  };

  function rawSend(obj: unknown): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  }

  function sendRequest(method: string, params: unknown, expectFinal = false): Promise<unknown> {
    const id = crypto.randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject, expectFinal });
      rawSend({ type: "req", id, method, params });
    });
  }

  function emitServerFrame(frame: ServerFrame): void {
    for (const h of eventHandlers) {
      try {
        h(frame);
      } catch {
        // Handlers must not crash the dispatcher.
      }
    }
  }

  function dispatchMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const frame = parsed as Record<string, unknown>;

    // hello-ok arrives both as standalone and inside res payload — handle either.
    if (frame.type === "res" && typeof frame.id === "string") {
      const pendingEntry = pending.get(frame.id);
      if (pendingEntry) {
        const payload = frame.payload as Record<string, unknown> | undefined;
        const status = payload?.status;
        // Two-phase: suppress "accepted" if the caller expects a final.
        if (pendingEntry.expectFinal && status === "accepted") return;
        pending.delete(frame.id);
        if (frame.ok === true) {
          pendingEntry.resolve(frame.payload);
        } else {
          const err = (frame.error ?? {}) as Record<string, unknown>;
          const message = typeof err.message === "string" ? err.message : "gateway error";
          const code = typeof err.code === "string" ? err.code : "GATEWAY_ERROR";
          pendingEntry.reject(new Error(`${code}: ${message}`));
        }
        // ALSO project to ServerFrame so the BFF can surface terminal/error.
        const projected = mapper.map(frame);
        if (projected) emitServerFrame(projected);
        return;
      }
    }

    // Capture the connect challenge nonce before any other dispatch.
    if (
      frame.type === "event" &&
      frame.event === "connect.challenge" &&
      frame.payload &&
      typeof frame.payload === "object"
    ) {
      const p = frame.payload as Record<string, unknown>;
      if (typeof p.nonce === "string" && p.nonce.trim()) {
        nonce = p.nonce.trim();
        return;
      }
    }

    // Everything else: project + emit if relevant.
    const projected = mapper.map(frame);
    if (projected) {
      if (projected.type === "decision-required") lastApprovalId = projected.plateId;
      emitServerFrame(projected);
    }
  }

  return new Promise<GatewayClient>((resolve, reject) => {
    const overall = setTimeout(() => {
      reject(new Error(`Gateway connect timed out after ${CONNECT_TIMEOUT_MS}ms`));
      ws.close();
    }, CONNECT_TIMEOUT_MS);
    cleanupTimers.push(overall);

    ws.on("open", () => {
      // Wait for connect.challenge before sending the connect req.
      // Poll briefly — the gateway emits it within milliseconds of accept.
      const start = Date.now();
      const interval = setInterval(() => {
        if (nonce) {
          clearInterval(interval);
          try {
            const signedAtMs = Date.now();
            const platform = process.platform;
            const signingPayload = buildDeviceAuthSigningPayload({
              deviceId: identity.deviceId,
              clientId: CLIENT_NAME,
              clientMode: CLIENT_MODE,
              role: DEFAULT_ROLE,
              scopes,
              signedAtMs,
              token: deviceToken ?? null,
              nonce,
              platform,
            });
            const signature = signWithPrivateKeyPem(identity.privateKeyPem, signingPayload);
            const params = {
              minProtocol: 4,
              maxProtocol: 4,
              client: {
                id: CLIENT_NAME,
                version: CLIENT_VERSION,
                platform,
                mode: CLIENT_MODE,
              },
              caps: ["tool-events"],
              role: DEFAULT_ROLE,
              scopes,
              device: {
                id: identity.deviceId,
                publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
                signature,
                signedAt: signedAtMs,
                nonce,
              },
              ...(deviceToken ? { auth: { token: deviceToken, deviceToken } } : {}),
            };
            sendRequest("connect", params)
              .then(() => {
                helloReceived = true;
                clearAllTimers();
                resolve(client);
              })
              .catch((err: Error) => {
                clearAllTimers();
                reject(err);
                ws.close();
              });
          } catch (e) {
            clearAllTimers();
            reject(e as Error);
            ws.close();
          }
        } else if (Date.now() - start > CONNECT_TIMEOUT_MS) {
          clearInterval(interval);
          // overall timer will fire; nothing to do.
        }
      }, 25);
      cleanupTimers.push(interval as unknown as NodeJS.Timeout);
    });

    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      const raw = Buffer.isBuffer(data)
        ? data.toString("utf8")
        : Array.isArray(data)
          ? Buffer.concat(data as Buffer[]).toString("utf8")
          : Buffer.from(data as ArrayBuffer).toString("utf8");
      dispatchMessage(raw);
    });

    ws.on("close", () => {
      clearAllTimers();
      for (const h of closeHandlers) {
        try {
          h();
        } catch {
          // ignore handler crashes during close
        }
      }
      if (!helloReceived) {
        reject(new Error("Gateway WS closed before hello-ok"));
      }
    });

    ws.on("error", (err: Error) => {
      // ws emits error then close; surface the error only if pre-handshake.
      if (!helloReceived) {
        clearAllTimers();
        reject(err);
      }
    });

    const client: GatewayClient = {
      send(frame: ClientFrame): void {
        const req = translateClientFrame(frame, {
          lastApprovalId,
          newId: () => crypto.randomUUID(),
        });
        if (!req) return;
        rawSend(req);
        // One approval is one decision; clear so a stale id can't double-resolve.
        if (frame.type === "decision") lastApprovalId = null;
      },
      onEvent(handler: (event: ServerFrame) => void): void {
        eventHandlers.push(handler);
      },
      onClose(handler: () => void): void {
        closeHandlers.push(handler);
      },
      close(): void {
        ws.close();
      },
    };
  });
}

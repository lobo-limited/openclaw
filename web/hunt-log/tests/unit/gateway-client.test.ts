// Unit tests for the BFF-side Gateway WebSocket client.
//
// Scope: pure helpers that project raw Gateway wire frames into ServerFrames,
// plus the canonical-signing string builder. The live connect handshake is an
// integration concern (Task 16). See web/hunt-log/docs/gateway-frames.md for
// the wire shapes under test.

import { describe, it, expect } from "vitest";
import {
  mapGatewayEvent,
  createGatewayEventMapper,
  buildDeviceAuthSigningPayload,
  publicKeyRawBase64UrlFromPem,
  type ServerFrame,
} from "../../src/lib/gateway/client";

// ---------------------------------------------------------------------------
// Synthetic wire-frame fixtures. Shapes mirror docs/gateway-frames.md +
// raw-capture in docs/gateway-frames-raw.jsonl.
// ---------------------------------------------------------------------------

function agentEvent(
  stream: string,
  data: Record<string, unknown>,
  runId = "run-1",
  sessionKey = "agent:ops:main",
  seq = 1,
) {
  return {
    type: "event",
    event: "agent",
    seq: 100 + seq,
    payload: { runId, sessionKey, seq, ts: 1779890868600, stream, data },
  };
}

function chatEvent(
  state: string,
  extras: Record<string, unknown>,
  runId = "run-1",
  sessionKey = "agent:ops:main",
  seq = 1,
) {
  return {
    type: "event",
    event: "chat",
    seq: 200 + seq,
    payload: { runId, sessionKey, seq, state, ...extras },
  };
}

// ---------------------------------------------------------------------------
// mapGatewayEvent — agent lifecycle / assistant / plan / tool
// ---------------------------------------------------------------------------

describe("mapGatewayEvent: agent stream", () => {
  it("projects agent.lifecycle phase=start to a session frame", () => {
    const wire = agentEvent(
      "lifecycle",
      { phase: "start", startedAt: 1779890868600 },
      "run-1",
      "agent:ops:main",
    );
    const out = mapGatewayEvent(wire);
    expect(out).toEqual({ type: "session", id: "agent:ops:main", createdAt: expect.any(String) });
    // createdAt must be a valid ISO string
    expect(out && Number.isFinite(Date.parse((out as { createdAt: string }).createdAt))).toBe(true);
  });

  it("drops agent.lifecycle phase=end (terminal signal arrives via res)", () => {
    const wire = agentEvent("lifecycle", {
      phase: "end",
      endedAt: 1779890878000,
      livenessState: "working",
    });
    expect(mapGatewayEvent(wire)).toBeNull();
  });

  it("projects agent.plan to a plan trace", () => {
    const wire = agentEvent("plan", { steps: ["a", "b"], rationale: "x" }, "run-7");
    const out = mapGatewayEvent(wire);
    expect(out).toEqual({
      type: "trace",
      kind: "plan",
      id: expect.stringContaining("run-7"),
      data: { steps: ["a", "b"], rationale: "x" },
    });
  });

  it("projects agent.tool to a specimen trace keyed by runId+tool-seq", () => {
    const wire = agentEvent(
      "tool",
      { tool: "bash", file: "foo.ts", phase: "start" },
      "run-9",
      "agent:ops:main",
      3,
    );
    const out = mapGatewayEvent(wire);
    expect(out).toEqual({
      type: "trace",
      kind: "specimen",
      id: "run-9:tool:3",
      data: expect.objectContaining({ tool: "bash", file: "foo.ts" }),
    });
    const specimen = out as unknown as { data: { startedAt: number } };
    expect(specimen.data.startedAt).toBeTypeOf("number");
  });

  it("projects the first agent.assistant for a runId to a reply trace", () => {
    const mapper = createGatewayEventMapper();
    const wire = agentEvent("assistant", { text: "ok", delta: "ok" }, "run-5");
    expect(mapper.map(wire)).toEqual({
      type: "trace",
      kind: "reply",
      id: "run-5:reply",
      data: { text: "" },
    });
  });

  it("projects subsequent agent.assistant frames for same runId to deltas", () => {
    const mapper = createGatewayEventMapper();
    mapper.map(agentEvent("assistant", { text: "ok", delta: "ok" }, "run-5"));
    const second = mapper.map(agentEvent("assistant", { text: "ok!", delta: "!" }, "run-5"));
    expect(second).toEqual({ type: "delta", traceId: "run-5:reply", text: "!" });
  });

  it("falls back to data.text when data.delta is missing on assistant", () => {
    const mapper = createGatewayEventMapper();
    mapper.map(agentEvent("assistant", { text: "x", delta: "x" }, "run-6"));
    const out = mapper.map(agentEvent("assistant", { text: "second-token" }, "run-6"));
    expect(out).toEqual({ type: "delta", traceId: "run-6:reply", text: "second-token" });
  });

  it("does NOT throw on unknown agent stream values", () => {
    const wire = agentEvent("usage", { totalTokens: 100 });
    expect(() => mapGatewayEvent(wire)).not.toThrow();
    expect(mapGatewayEvent(wire)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapGatewayEvent — chat events
// ---------------------------------------------------------------------------

describe("mapGatewayEvent: chat stream", () => {
  it("projects the first chat.delta for a runId to a reply trace", () => {
    const mapper = createGatewayEventMapper();
    const out = mapper.map(
      chatEvent(
        "delta",
        {
          deltaText: "hello",
          message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
        },
        "run-2",
      ),
    );
    expect(out).toEqual({ type: "trace", kind: "reply", id: "run-2:reply", data: { text: "" } });
  });

  it("projects subsequent chat.delta to delta frames", () => {
    const mapper = createGatewayEventMapper();
    mapper.map(chatEvent("delta", { deltaText: "hi" }, "run-2"));
    const out = mapper.map(chatEvent("delta", { deltaText: "!" }, "run-2"));
    expect(out).toEqual({ type: "delta", traceId: "run-2:reply", text: "!" });
  });

  it("treats agent.assistant + chat.delta as one trace per runId", () => {
    const mapper = createGatewayEventMapper();
    expect(mapper.map(agentEvent("assistant", { text: "ok", delta: "ok" }, "run-4"))).toMatchObject(
      {
        type: "trace",
        kind: "reply",
      },
    );
    // chat.delta arrives next — should NOT make a second trace
    const out = mapper.map(chatEvent("delta", { deltaText: " more" }, "run-4"));
    expect(out).toEqual({ type: "delta", traceId: "run-4:reply", text: " more" });
  });

  it("projects chat.final to a complete frame keyed by the reply trace id", () => {
    const mapper = createGatewayEventMapper();
    mapper.map(agentEvent("assistant", { delta: "x" }, "run-3"));
    const out = mapper.map(
      chatEvent("final", { message: { role: "assistant", content: [] } }, "run-3"),
    );
    expect(out).toEqual({ type: "complete", traceId: "run-3:reply" });
  });

  it("projects chat.error to an error frame", () => {
    const wire = chatEvent("error", { errorKind: "rate_limit", errorMessage: "slow down" });
    expect(mapGatewayEvent(wire)).toEqual({
      type: "error",
      code: "rate_limit",
      message: "slow down",
    });
  });

  it("defaults chat.error code+message when fields absent", () => {
    const wire = chatEvent("error", {});
    expect(mapGatewayEvent(wire)).toEqual({ type: "error", code: "CHAT_ERROR", message: "" });
  });

  it("projects chat.aborted to an error frame with ABORTED code", () => {
    const wire = chatEvent("aborted", { stopReason: "user_interrupt" });
    expect(mapGatewayEvent(wire)).toEqual({
      type: "error",
      code: "ABORTED",
      message: "user_interrupt",
    });
  });
});

// ---------------------------------------------------------------------------
// mapGatewayEvent — approval surfaces
// ---------------------------------------------------------------------------

describe("mapGatewayEvent: approval requests", () => {
  it("projects exec.approval.requested to a decision-required frame", () => {
    const wire = {
      type: "event",
      event: "exec.approval.requested",
      payload: {
        id: "appr-1",
        request: {
          files: [{ name: "a.ts", hunks: "@@ ..." }],
          notes: ["heads up"],
        },
        createdAtMs: 1,
        expiresAtMs: 2,
      },
    };
    expect(mapGatewayEvent(wire)).toEqual({
      type: "decision-required",
      plateId: "appr-1",
      proposal: { files: [{ name: "a.ts", hunks: "@@ ..." }], notes: ["heads up"] },
    });
  });

  it("projects plugin.approval.requested to a decision-required frame", () => {
    const wire = {
      type: "event",
      event: "plugin.approval.requested",
      payload: { id: "appr-2", request: {}, createdAtMs: 1, expiresAtMs: 2 },
    };
    expect(mapGatewayEvent(wire)).toEqual({
      type: "decision-required",
      plateId: "appr-2",
      proposal: { files: [], notes: [] },
    });
  });

  it("tolerates missing/malformed files+notes on approval request", () => {
    const wire = {
      type: "event",
      event: "exec.approval.requested",
      payload: { id: "appr-3", request: { files: "not-an-array", notes: 42 } },
    };
    expect(mapGatewayEvent(wire)).toEqual({
      type: "decision-required",
      plateId: "appr-3",
      proposal: { files: [], notes: [] },
    });
  });

  it("drops exec.approval.resolved (decision flows back via terminal res)", () => {
    const wire = {
      type: "event",
      event: "exec.approval.resolved",
      payload: { id: "appr-1", decision: "approve" },
    };
    expect(mapGatewayEvent(wire)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapGatewayEvent — terminal response frame
// ---------------------------------------------------------------------------

describe("mapGatewayEvent: terminal res frames", () => {
  it("projects a successful agent res to a final frame", () => {
    const wire = {
      type: "res",
      id: "req-1",
      ok: true,
      payload: { runId: "run-1", status: "ok", summary: "completed", result: { meta: {} } },
    };
    expect(mapGatewayEvent(wire)).toEqual({
      type: "final",
      outcome: "applied",
      summary: "completed",
    });
  });

  it("uses an empty summary when none is provided", () => {
    const wire = { type: "res", id: "req-1", ok: true, payload: { runId: "run-1", status: "ok" } };
    expect(mapGatewayEvent(wire)).toEqual({ type: "final", outcome: "applied", summary: "" });
  });

  it("drops the immediate accepted ack", () => {
    const wire = {
      type: "res",
      id: "req-1",
      ok: true,
      payload: { runId: "run-1", status: "accepted", acceptedAt: 1 },
    };
    expect(mapGatewayEvent(wire)).toBeNull();
  });

  it("projects ok=false to an error frame", () => {
    const wire = {
      type: "res",
      id: "req-1",
      ok: false,
      error: { code: "BAD_REQUEST", message: "missing field" },
    };
    expect(mapGatewayEvent(wire)).toEqual({
      type: "error",
      code: "BAD_REQUEST",
      message: "missing field",
    });
  });

  it("projects aborted res to a rejected final frame", () => {
    const wire = {
      type: "res",
      id: "req-1",
      ok: true,
      payload: { runId: "run-1", status: "aborted", summary: "user stop" },
    };
    expect(mapGatewayEvent(wire)).toEqual({
      type: "final",
      outcome: "rejected",
      summary: "user stop",
    });
  });
});

// ---------------------------------------------------------------------------
// Drop-list — irrelevant events MUST become null without throwing
// ---------------------------------------------------------------------------

describe("mapGatewayEvent: drops irrelevant frames", () => {
  const drop = (event: string, payload: unknown = {}) => ({ type: "event", event, payload });

  it.each([
    ["tick", { ts: 1 }],
    ["health", { snapshot: {} }],
    ["presence", {}],
    ["sessions.changed", {}],
    ["update.available", {}],
    ["voicewake.changed", {}],
    ["voicewake.routing.changed", {}],
    ["shutdown", {}],
    ["heartbeat", {}],
    ["cron", {}],
    ["node.pair.requested", {}],
    ["device.pair.requested", {}],
    ["talk.mode", {}],
    ["talk.event", {}],
    ["session.message", {}],
    ["session.operation", {}],
    ["session.tool", {}],
    ["connect.challenge", { nonce: "x", ts: 1 }],
  ])("drops event %s", (event, payload) => {
    expect(mapGatewayEvent(drop(event, payload))).toBeNull();
  });

  it("drops hello-ok handshake frames", () => {
    expect(mapGatewayEvent({ type: "hello-ok", protocol: 4 })).toBeNull();
  });

  it("drops unknown event names without throwing", () => {
    expect(mapGatewayEvent({ type: "event", event: "no.such.thing", payload: {} })).toBeNull();
    expect(() =>
      mapGatewayEvent({ type: "event", event: "no.such.thing", payload: {} }),
    ).not.toThrow();
  });

  it("drops malformed wire frames without throwing", () => {
    expect(mapGatewayEvent(null)).toBeNull();
    expect(mapGatewayEvent(42)).toBeNull();
    expect(mapGatewayEvent("nope")).toBeNull();
    expect(mapGatewayEvent({})).toBeNull();
    expect(mapGatewayEvent({ type: "event" })).toBeNull();
    expect(mapGatewayEvent({ type: "event", event: "agent" })).toBeNull();
    expect(mapGatewayEvent({ type: "event", event: "agent", payload: {} })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildDeviceAuthSigningPayload — canonicalization
// ---------------------------------------------------------------------------

describe("buildDeviceAuthSigningPayload (canonical v3)", () => {
  it("matches the OpenClaw client.js buildDeviceAuthPayloadV3 layout exactly", () => {
    const payload = buildDeviceAuthSigningPayload({
      deviceId: "deadbeef",
      clientId: "gateway-client",
      clientMode: "backend",
      role: "operator",
      scopes: ["operator.admin", "operator.read"],
      signedAtMs: 1779890540245,
      token: "TOK",
      nonce: "NONCE",
      platform: "Linux",
      deviceFamily: "Server",
    });
    expect(payload).toBe(
      "v3|deadbeef|gateway-client|backend|operator|operator.admin,operator.read|1779890540245|TOK|NONCE|linux|server",
    );
  });

  it("uses an empty string slot when token is null/undefined", () => {
    const a = buildDeviceAuthSigningPayload({
      deviceId: "id",
      clientId: "gateway-client",
      clientMode: "backend",
      role: "operator",
      scopes: ["operator.admin"],
      signedAtMs: 1,
      token: null,
      nonce: "n",
      platform: "linux",
    });
    const b = buildDeviceAuthSigningPayload({
      deviceId: "id",
      clientId: "gateway-client",
      clientMode: "backend",
      role: "operator",
      scopes: ["operator.admin"],
      signedAtMs: 1,
      nonce: "n",
      platform: "linux",
    });
    expect(a).toBe(b);
    expect(a).toBe("v3|id|gateway-client|backend|operator|operator.admin|1|" + "" + "|n|linux|");
  });

  it("normalizes platform + deviceFamily to ASCII-lowercase, trimmed", () => {
    const payload = buildDeviceAuthSigningPayload({
      deviceId: "id",
      clientId: "gateway-client",
      clientMode: "backend",
      role: "operator",
      scopes: [],
      signedAtMs: 1,
      nonce: "n",
      platform: "  MacOS  ",
      deviceFamily: "  HOMElab  ",
    });
    expect(payload.endsWith("|macos|homelab")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// publicKeyRawBase64UrlFromPem — round-trip with Node crypto
// ---------------------------------------------------------------------------

describe("publicKeyRawBase64UrlFromPem", () => {
  it("extracts the 32-byte ed25519 public key as base64url", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const { publicKey } = generateKeyPairSync("ed25519");
    const pem = publicKey.export({ type: "spki", format: "pem" }) as string;
    const b64u = publicKeyRawBase64UrlFromPem(pem);
    // base64url: no +, no /, no = padding; ed25519 raw = 32 bytes = ~43 chars
    expect(b64u).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(b64u.length).toBe(43);
  });
});

// ---------------------------------------------------------------------------
// Type contract — module exports the public interface
// ---------------------------------------------------------------------------

describe("module surface", () => {
  it("exports mapGatewayEvent that returns ServerFrame | null", () => {
    const out: ServerFrame | null = mapGatewayEvent({
      type: "event",
      event: "tick",
      payload: { ts: 1 },
    });
    expect(out).toBeNull();
  });
});

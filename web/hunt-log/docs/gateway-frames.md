# OpenClaw Gateway Frame Reference (wire-captured 2026-05-27)

## Source

- Gateway version: **2026.5.18** (CLI `openclaw 2026.5.18` and runtime `Gateway version: 2026.5.18`, reported via `openclaw gateway status`).
- Server connId observed: `7ca02740-4171-4bfa-b562-e8108e26091d`.
- Source path: `/home/lrjhr/.npm-global/lib/node_modules/openclaw/dist/`
  - Authoritative schemas: `dist/protocol-CdYy0xVK.js` (search for `AgentParamsSchema`, `EventFrameSchema`, `RequestFrameSchema`, `ResponseFrameSchema`, `HelloOkSchema`, `AgentEventSchema`, `ChatEventSchema`, `ConnectParamsSchema`, `ErrorShapeSchema`).
  - Client allow-list: `dist/client-info-wu-8nEST.js` (the `GATEWAY_CLIENT_IDS` set — connect frame's `client.id` MUST be one of these).
  - Server broadcaster: `dist/server-chat-Bvm45tyg.js` (function `sendAgentPayload` / `broadcast("agent", payload)` / `broadcast("chat", payload)`).
  - Connect-challenge emitter: `dist/server-ws-runtime-DeNw-k9S.js:158-165` (the very first frame the gateway sends after a TCP accept).
  - Approval contracts: `dist/exec-approval-DV5soCrB.js`, `dist/plugin-approval-ul2XU3pX.js`, `dist/approval-shared-CJblU2FF.js`.
- Wire-capture date: 2026-05-27
- Capture artifacts in this directory:
  - `gateway-frames-sample-1.json` — output of `openclaw gateway call agent --expect-final` (the condensed final result).
  - `gateway-frames-raw.jsonl` — one JSON envelope per line captured directly off the WebSocket via the in-tree `GatewayClient`, including `hello-ok`, every `event` frame, and the response frame for the `agent` request.
- Capture tool used for the raw stream: a small Node script (`/tmp/raw-capture-via-client.mjs`) that imported the gateway's own `GatewayClient` and replayed it with the existing device identity at `~/.openclaw/identity/device.json`. The raw frames are exactly what the BFF will see.

## Transport / framing — important corrections vs the plan

Every WebSocket message is a single JSON document whose top-level **discriminator is `type`** (literal `"req"` / `"res"` / `"event"` / `"hello-ok"`). The plan implicitly assumed flat events; it is partly right — there is no JSON-RPC `jsonrpc:"2.0"` envelope — but the discriminator is **`type`**, not `method` or `event`, and the literal values matter.

```ts
// dist/protocol-CdYy0xVK.js:1952-1976
RequestFrame  = { type: "req",   id: string, method: string, params?: unknown }
ResponseFrame = { type: "res",   id: string, ok: boolean, payload?: unknown, error?: ErrorShape }
EventFrame    = { type: "event", event: string, payload?: unknown, seq?: number, stateVersion?: { presence: number, health: number } }
GatewayFrame  = RequestFrame | ResponseFrame | EventFrame   // discriminator: "type"

ErrorShape    = { code: string, message: string, details?: unknown, retryable?: boolean, retryAfterMs?: number }
```

The `event` frame's *event name* (e.g. `"agent"`, `"chat"`, `"tick"`) lives at `payload.... no — at the top-level field `event`. The **per-event payload** is at `payload`, and itself has its own internal discriminators (`stream` for `agent`-events, `state` for `chat`-events). This is two levels of dispatch:

```
ws message → frame.type === "event"
            └── frame.event === "agent" | "chat" | "tick" | "health" | …
                └── frame.payload.stream  (agent events)
                    frame.payload.state   (chat events)
```

`hello-ok` is its own top-level type (not a `res` to the connect request — the response to `connect` is delivered as a `res` containing the hello payload, see capture).

## Connect handshake (wire-captured)

URL: `ws://127.0.0.1:18789` (loopback only — bound by the running service).

Sequence:

1. Server sends an `event` frame **before any client write**:
   ```json
   {"type":"event","event":"connect.challenge","payload":{"nonce":"<uuid>","ts":1779890540245}}
   ```
   The BFF must wait for this frame and remember `nonce`.

2. Client sends `req` frame `method: "connect"` whose params are `ConnectParamsSchema`:
   ```ts
   // dist/protocol-CdYy0xVK.js:1878-1913
   {
     minProtocol: number,            // observed: gateway accepts client {min: 4, max: 100}
     maxProtocol: number,
     client: {
       id: "cli" | "webchat-ui" | "openclaw-control-ui" | "openclaw-tui" | "webchat"
         | "gateway-client" | "openclaw-macos" | "openclaw-ios" | "openclaw-android"
         | "node-host" | "test" | "fingerprint" | "openclaw-probe",   // GATEWAY_CLIENT_IDS
       displayName?: string,
       version: string,
       platform: string,             // observed: "linux"
       deviceFamily?: string,
       mode: "webchat"|"cli"|"ui"|"backend"|"node"|"probe"|"test",
       instanceId?: string
     },
     caps?: string[],                // observed cap: "tool-events"
     commands?: string[],
     permissions?: Record<string, boolean>,
     pathEnv?: string,
     role?: string,                  // observed: "operator"
     scopes?: string[],              // observed: ["operator.admin","operator.read","operator.write"]
     device?: {                      // REQUIRED in the running config (authMode=token, but the gateway also enforces a device-pair check on all non-loopback-bootstrap callers)
       id: string,                   // ed25519 SHA-256 fingerprint hex
       publicKey: string,            // base64url of raw ed25519 public key
       signature: string,            // ed25519 sig over a canonical payload (see dist/client-CYDoDi4S.js:481-503 + buildDeviceAuthPayloadV3)
       signedAt: number,             // ms epoch
       nonce: string                 // echo of the connect.challenge nonce
     },
     auth?: {                        // optional token-mode credentials
       token?: string,               // shared gateway token (snapshot.authMode === "token")
       bootstrapToken?: string,
       deviceToken?: string,         // returned to the client in a prior helloOk.auth.deviceToken — observed in our capture
       password?: string,
       approvalRuntimeToken?: string
     },
     locale?: string,
     userAgent?: string
   }
   ```
   **Auth mode currently in service:** the running gateway reports `snapshot.authMode === "token"` and `helloOk.auth.role === "operator"`, `helloOk.auth.scopes === ["operator.admin"]`. The CLI is paired (`~/.openclaw/identity/device.json` + `~/.openclaw/identity/device-auth.json`), so connect already requires a signed `device` block AND scope-aligned `auth.deviceToken`. The plan's note that "the Gateway uses `--auth none`" is **WRONG** for the live service: a connect without `device` is rejected with `error.code === "NOT_PAIRED"`, and a connect with a stored device-token whose scopes don't match the requested role is rejected with `unauthorized: device token scope mismatch (re-pair or approve scope upgrade)`.

3. Server responds with a `res` frame to the connect request, with `payload === HelloOkSchema`:
   ```ts
   // dist/protocol-CdYy0xVK.js:1914-1944
   {
     type: "hello-ok",
     protocol: 4,
     server: { version: string, connId: string },
     features: {
       methods: string[],   // 173 entries on this gateway (full list in raw.jsonl line 1)
       events:  string[]    // 27 entries — see "All advertised event names" below
     },
     snapshot: Snapshot,    // presence + health snapshot + sessionDefaults + authMode + ...
     pluginSurfaceUrls?: Record<string, string>,
     auth: {
       role: string,                  // "operator"
       scopes: string[],              // ["operator.admin"]
       deviceToken?: string,          // present — BFF should persist for reconnect
       issuedAtMs?: number,
       deviceTokens?: [{ deviceToken, role, scopes, issuedAtMs }]
     },
     policy: { maxPayload, maxBufferedBytes, tickIntervalMs }
   }
   ```
   This payload is wrapped: the WS message we received was `{"type":"res","id":"<our-connect-id>","ok":true,"payload":{ type:"hello-ok", ... }}`.

4. Server then continues to emit unsolicited `event` frames — `tick` (cadence ~`policy.tickIntervalMs`, default 30s), `health` (when snapshot changes), `presence` etc. The BFF must tolerate these even when no `agent` call is in flight.

### All 27 advertised event names (from `helloOk.features.events`)

```
connect.challenge   agent              chat               session.message
session.operation   session.tool       sessions.changed   presence
tick                talk.mode          talk.event         shutdown
health              heartbeat          cron               node.pair.requested
node.pair.resolved  node.invoke.request  device.pair.requested  device.pair.resolved
voicewake.changed   voicewake.routing.changed  exec.approval.requested
exec.approval.resolved  plugin.approval.requested  plugin.approval.resolved
update.available
```

Note `connect.challenge` is the only event that fires **before** the connect handshake.

## `agent` method — request

Schema (verbatim from `dist/protocol-CdYy0xVK.js:214-259`, `AgentParamsSchema`):

```ts
{
  message: string (non-empty),       // required
  agentId?: string,                  // required-in-practice: caller must supply at least one of {agentId, sessionId, to}
  provider?: string,                 // REJECTED in non-bootstrap callers — "provider/model overrides are not authorized for this caller"
  model?: string,                    // same — rejected
  to?: string,
  replyTo?: string,
  sessionId?: string,
  sessionKey?: string,
  thinking?: string,
  deliver?: boolean,
  attachments?: unknown[],
  channel?: string,
  replyChannel?: string,
  accountId?: string,
  replyAccountId?: string,
  threadId?: string,
  groupId?: string, groupChannel?: string, groupSpace?: string,
  timeout?: integer >= 0,
  bestEffortDeliver?: boolean,
  lane?: string,
  cleanupBundleMcpOnRunEnd?: boolean,
  modelRun?: boolean,
  promptMode?: "full" | "minimal" | "none",
  extraSystemPrompt?: string,
  bootstrapContextMode?: "full" | "lightweight",
  bootstrapContextRunKind?: "default" | "heartbeat" | "cron",
  acpTurnSource?: "manual_spawn",
  internalRuntimeHandoffId?: string,
  internalEvents?: AgentInternalEvent[],
  inputProvenance?: InputProvenance,
  sourceReplyDeliveryMode?: "automatic" | "message_tool_only",
  voiceWakeTrigger?: string,
  idempotencyKey: string (non-empty), // REQUIRED — the plan does not mention this; omitting it returns
                                       //   `invalid agent params: must have required property 'idempotencyKey'`
  label?: string                       // 1-512 chars
}
```

Real wire request (line 3 of raw capture is the `res`, the `req` was authored by us — the literal frame the BFF sends):

```json
{
  "type": "req",
  "id": "<uuid-v4>",
  "method": "agent",
  "params": {
    "message": "Reply with: ok.",
    "agentId": "ops",
    "idempotencyKey": "hunt-log-task-4-raw-5da85f4e"
  }
}
```

### `agent` method — response (`res` frame)

The response arrives **immediately** (within a few ms — the gateway acks and the actual run is async). The plan implied a single final response; reality is more nuanced:

- **Immediate `res`** (verbatim from raw capture):
  ```json
  {"type":"res","id":"<our-req-id>","ok":true,
   "payload":{"runId":"hunt-log-task-4-raw-5da85f4e","status":"accepted","acceptedAt":1779890868600}}
  ```
- **Terminal response** is delivered separately. If the client passed `expectFinal: true` to its pending-request bookkeeping, the gateway client suppresses the `status === "accepted"` response and waits for a *second* `res` with the same `id` containing the final payload (see `dist/client-CYDoDi4S.js:710-725`). That terminal `res` payload was captured via `--expect-final` in `gateway-frames-sample-1.json`:
  ```json
  {
    "runId": "hunt-log-task-4-sample-final",
    "status": "ok",
    "summary": "completed",
    "result": {
      "payloads": [{ "text": "ok", "mediaUrl": null }],
      "meta": {
        "durationMs": 9396,
        "agentMeta": { "sessionId": "<uuid>", "sessionFile": "<path>", "provider": "nvidia-ngc",
                       "model": "qwen/qwen3-coder-480b-a35b-instruct", "usage": {...}, ... },
        "aborted": false,
        "systemPromptReport": { ... },          // big diagnostic blob
        "finalPromptText": "...",
        "finalAssistantVisibleText": "ok",
        "finalAssistantRawText": "ok",
        "livenessState": "working",
        "stopReason": "stop",
        "executionTrace": { "winnerProvider": ..., "attempts": [...], "fallbackUsed": false, "runner": "embedded" },
        "completion": { "stopReason": "stop", "finishReason": "stop" }
      }
    }
  }
  ```

**Key BFF implication:** the "final" signal is the terminal `res` (with `status === "ok"|"error"|"aborted"`), **not** any event-stream frame. The agent stream's `lifecycle:end` event marks the *server-side end of the run* but the BFF should hold the request open until the matching `res` arrives.

## `agent` method — event stream (wire-captured)

For the agent call above, the sequence of `event` frames was (full payloads in `gateway-frames-raw.jsonl`):

| # | `event` | `payload.stream` / `state` | `payload.data` highlights | `seq` |
|---|---------|----------------------------|---------------------------|-------|
| 1 | `health` | — | snapshot delta | 1 |
| 2 | `agent` | `stream: "lifecycle"` | `data: { phase: "start", startedAt }` | 2 |
| 3 | `agent` | `stream: "assistant"` | `data: { text: "ok", delta: "ok" }` | 3 |
| 4 | `chat` | `state: "delta"` | `deltaText: "ok"`, `message: { role:"assistant", content:[{type:"text",text:"ok"}], timestamp }` | 4 |
| 5 | `agent` | `stream: "lifecycle"` | `data: { phase: "end", livenessState: "working", endedAt }` | 5 |
| 6 | `chat` | `state: "final"` | `message: { role:"assistant", content:[...], timestamp }` | 6 |
| 7 | `tick` | — | `{ ts }` | 7 |

### Discriminators

- **Top-level (any `event` frame):** `frame.event` (string). Observed values during an agent run: `agent`, `chat`, `tick`, `health`. Other surfaces (`presence`, `sessions.changed`, etc.) may fire concurrently.
- **`event: "agent"` payload:** `payload.stream` is the agent-stream discriminator (schema `AgentEventSchema` at `dist/protocol-CdYy0xVK.js:124-132`).
  - Observed: `"lifecycle"`, `"assistant"`.
  - Per-source `dist/agent-events-DVSiKwui.js:73-112` and `dist/server-chat-Bvm45tyg.js`, the full set is: `lifecycle`, `assistant`, `thinking`, `tool`, `item`, `plan`, `approval`, `command_output`, `patch`, `usage`, `error` (server emits a synthetic `stream: "error"` on seq gaps — `server-chat-Bvm45tyg.js:631-642`).
  - `payload` shape always:
    ```ts
    {
      runId: string,             // matches the runId returned in the "accepted" res
      sessionKey: string,        // e.g. "agent:ops:main"
      spawnedBy?: string,        // if the run is a subagent
      seq: integer >= 0,         // per-run monotonic
      ts: integer (ms epoch),
      stream: string,            // the discriminator
      data: Record<string, unknown>,  // shape depends on stream — see below
      isHeartbeat?: boolean
    }
    ```
  - `data` per stream (from source):
    - `lifecycle`: `{ phase: "start"|"end"|... , startedAt?: number, endedAt?: number, livenessState?: string }`.
    - `assistant` / `thinking`: `{ text?: string, delta?: string, replace?: boolean, mediaUrl?: string, mediaUrls?: string[] }` — `delta` is the streaming token, `text` is the running cumulative text.
    - `tool`: tool-invocation events; the gateway will strip `data.result` / `data.partialResult` for callers below `toolVerbose === "full"`.
    - `item`, `plan`, `approval`, `command_output`, `patch`: see `dist/agent-events-DVSiKwui.js` — they are bare passthroughs `{ data: <plugin-provided> }`.
- **`event: "chat"` payload:** `payload.state` is the discriminator (schema `ChatEventSchema` at `dist/protocol-CdYy0xVK.js:2048-2083`). Values: `"delta"`, `"final"`, `"aborted"`, `"error"`.
  - `delta`: `{ runId, sessionKey, seq, state:"delta", deltaText: string, message?: ChatMessage, replace?: boolean, usage?: unknown }`.
  - `final`: `{ runId, sessionKey, seq, state:"final", message?: ChatMessage, usage?: unknown, stopReason?: string }`.
  - `aborted`: `{ runId, sessionKey, seq, state:"aborted", message?, stopReason? }`.
  - `error`: `{ runId, sessionKey, seq, state:"error", message?, errorMessage?, errorKind?: "refusal"|"timeout"|"rate_limit"|"context_length"|"unknown", usage?, stopReason? }`.

### Ordering observed

1. `agent` events with `stream === "lifecycle"`, `data.phase === "start"` is the first run-scoped event.
2. Streaming text emits interleaved `agent.stream:"assistant"` + `chat.state:"delta"`. The gateway throttles assistant deltas (~150ms coalescing — see `server-chat-Bvm45tyg.js:553-571`) so consecutive deltas may be merged on the wire.
3. Run termination emits **both** `agent.stream:"lifecycle" data.phase:"end"` AND `chat.state:"final"` (with the same `runId`). They are not strictly ordered relative to each other; the server emits the assistant chat-final immediately after the assistant lifecycle-end in our capture.
4. The **terminal RPC response** (`res` frame with `status:"ok"|"error"|"aborted"`) arrives *after* all run events.
5. `tick` and `health` events interleave at any time and are unrelated to the run.

### How to detect "done"

The robust signal is the terminal `res` for the original `agent` request (see "Response" section above). If the BFF wants a streaming "the run is done" hint *before* the terminal `res`, watch for `event:"chat", state:"final"` (or `state:"aborted"`/`state:"error"`) keyed by `runId`.

`agent.stream:"lifecycle" data.phase:"end"` is also a valid hint but the schema does not promise it is the last event — `chat.state:"final"` arrived after it in our capture.

## `approvals` methods — request/response

The captured run did not require approval (it was a benign text echo). The shapes below are from source (`dist/exec-approval-DV5soCrB.js`, `dist/protocol-CdYy0xVK.js:1729-1781`).

Methods advertised in `helloOk.features.methods`:

```
exec.approvals.get          exec.approvals.set
exec.approvals.node.get     exec.approvals.node.set
exec.approval.get           exec.approval.list
exec.approval.request       exec.approval.waitDecision
exec.approval.resolve
plugin.approval.list        plugin.approval.request
plugin.approval.waitDecision  plugin.approval.resolve
```

Resolve (`exec.approval.resolve`) is the operator-side "approve/reject" call:

```ts
// ExecApprovalResolveParamsSchema
{ id: string, decision: string }
```

The `decision` is a free string in the schema; from `dist/exec-approval-DV5soCrB.js` legal values are `"approve"`, `"reject"`, `"deny"`, `"timeout"` (the gateway dedupes and broadcasts a `exec.approval.resolved` event).

Approval **request event** (server → broadcast, `event: "exec.approval.requested"`, `payload` shape from `dist/exec-approval-DV5soCrB.js:233-237`):

```ts
{
  id: string,
  request: ExecApprovalRequestParams,   // the full command/plan being asked for
  createdAtMs: number,
  expiresAtMs: number
}
```

`exec.approval.resolved` follows the same pattern with a `decision` field.

For plugin approvals (`plugin.approval.*`) the contract is symmetric; method names just swap `exec` → `plugin`.

## Other methods worth knowing about for v1

Selected from the 173 advertised methods that the BFF will plausibly want:

- **Session inventory:** `sessions.list`, `sessions.describe`, `sessions.preview`, `sessions.subscribe` / `sessions.unsubscribe`, `sessions.messages.subscribe` / `sessions.messages.unsubscribe`, `sessions.changed` event.
- **History:** `chat.history` (params `{ sessionKey, limit?, maxChars? }`).
- **Abort a run:** `chat.abort` (`{ sessionKey, runId? }`) — needed if the user clicks Stop.
- **Compaction:** `sessions.compaction.list`, `.get`, `.branch`, `.restore`, `sessions.compact`.
- **Agent inventory:** `agents.list`, `agent.identity.get`, `agents.create/update/delete`, `agents.files.{list,get,set}`.
- **Tools metadata:** `tools.catalog`, `tools.effective`, `tools.invoke`.
- **Health / diagnostics:** `health`, `diagnostics.stability`, `logs.tail`.
- **Other agent surfaces:** `agent.wait`, `message.action`, `send`.

## Discrepancies vs. the plan's assumed shapes

The plan at `/home/lrjhr/docs/superpowers/plans/2026-05-27-openclaw-hunt-log.md` Task 12 assumed these mappings. Below is the reconciliation against wire reality. **None of the plan's assumed event names exist on the wire** — the assumed names look like an idealized hand-drawn protocol; the real surface is `agent.stream:X` + `chat.state:Y`.

| Plan assumed Gateway event | Plan mapped to ServerFrame              | Reality on the wire                                                                                                                                                                                                                                                                  |
|----------------------------|------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `session.start`            | `{type: session, id, createdAt}`        | **Does not exist as a discrete event.** Closest analog: `agent` event with `stream:"lifecycle"`, `data.phase:"start"`. Session identity comes from `payload.sessionKey` on the lifecycle frame, plus the terminal `res.payload.result.meta.agentMeta.sessionId`.                  |
| `message.delta`            | `{type: delta, traceId, text}`          | Two valid sources, both with the same content: (a) `chat` event with `state:"delta"`, fields `runId`, `sessionKey`, `seq`, `deltaText`, optional `message`; or (b) `agent` event with `stream:"assistant"`, `data: {text, delta}`. Plan's `traceId` ↔ wire `runId`. There is no per-event `traceId`. |
| `message.complete`         | `{type: complete, traceId}`             | `chat` event with `state:"final"`. Carries `runId` + `sessionKey` + full `message`. Use this as the per-trace terminator.                                                                                                                                                          |
| `plan.ready`               | `{type: trace, kind: plan, ...}`        | `agent` event with `stream:"plan"`. `data` is the plugin-provided plan payload (no fixed schema beyond `Record<string, unknown>`). Discriminator is `payload.stream`, not `event.event`.                                                                                            |
| `tool.start`               | `{type: trace, kind: specimen, ...}`    | `agent` event with `stream:"tool"`. Single stream covers start AND complete — distinguish via `data` content (`data.phase`, presence of `data.result`/`data.partialResult`). Also: `event: "session.tool"` exists as a separate broadcast keyed off the session subscription channel — distinct from the per-run agent stream. |
| `reply.start`              | `{type: trace, kind: reply, ...}`       | **No discrete event.** The reply begins when the first `agent.stream:"assistant"` frame arrives. The plan's "reply" concept must be inferred client-side from the first assistant delta after a lifecycle-start.                                                                   |
| `approval.required`        | `{type: decision-required, ...}`        | `exec.approval.requested` (top-level event name). Payload: `{ id, request, createdAtMs, expiresAtMs }`. Also see `plugin.approval.requested` for plugin-tier approvals. The resolve method is `exec.approval.resolve` (or `plugin.approval.resolve`).                              |
| `session.final`            | `{type: final, outcome, summary}`       | The terminal `res` frame to the original `agent` request: `{type:"res", id:<reqId>, ok:true, payload:{runId, status:"ok"|"error"|"aborted", summary, result:{...}}}`. **This is not an `event` frame** — the BFF must keep the original request open and read the `res`.            |
| `error`                    | `{type: error, code, message}`          | Two paths: (a) request-level errors arrive as `res` with `ok:false, error: ErrorShape{code, message, details?, retryable?, retryAfterMs?}`; (b) run-level errors arrive as `chat` event with `state:"error"` carrying `errorMessage` + `errorKind`. The plan must handle both.       |

### Other surface drift the plan did not anticipate

1. **Connect frame requires a signed device identity** (when authMode is `token` and the device-pair check is enforced, which it is on this running gateway). The plan's `connect.params.auth.token` alone is **insufficient** — the gateway returns `NOT_PAIRED` / `DEVICE_IDENTITY_REQUIRED`. The BFF needs to load (or generate-and-pair) an ed25519 identity from disk before it can connect; reusing the CLI's `~/.openclaw/identity/device.json` is the easy path.
2. **`idempotencyKey` is required** on `agent` requests. The plan does not mention this.
3. **`provider` / `model` overrides are rejected** for the loopback-authenticated `cli` caller; in our tests this surfaced as `provider/model overrides are not authorized for this caller`. The BFF must omit them.
4. **`agent` returns *two* response frames** when the caller opts into `--expect-final` (`status:"accepted"` then the terminal one). Without that opt-in only the immediate accepted-ack arrives and the run continues async over events.
5. **`tick` event** fires every `helloOk.policy.tickIntervalMs` (30000ms in our capture) regardless of whether a run is in flight. The BFF must treat it as a heartbeat — it is **not** an agent event and must not be threaded into the conversation reducer. The plan's table omits it.
6. **`health` event** fires whenever the gateway snapshot changes; payload is large (~7 KB observed) and noisy. The BFF should subscribe selectively or drop these.
7. **`presence` event** fires when peers connect/disconnect. Likely irrelevant to v1 hunt-log but must be ignored without throwing on the unrecognized event.
8. **Per-`event` `seq` is the connection-scoped sequence**, not the per-run seq. The agent payload also carries its **own** `seq` field — the run-scoped one is `payload.seq`, the WS-frame one is `frame.seq`. Both can grow; do not confuse them.
9. **Schemas are `additionalProperties: false`** — the gateway will reject unknown fields on outgoing requests. Don't add speculative fields.
10. **State-version tracking:** the BFF can detect missed events via `frame.stateVersion = { presence: number, health: number }` on broadcast events; the gateway client uses an `onGap` callback to detect WS-level `frame.seq` gaps (see `dist/client-CYDoDi4S.js:698-704`).

### Auth + ping events the BFF must handle/ignore

- **Pre-connect:** `event: "connect.challenge"` — required, BFF must consume the nonce.
- **Heartbeat:** `event: "tick"` — ignore (or use to detect liveness).
- **Snapshot churn:** `event: "health"`, `event: "presence"`, `event: "sessions.changed"`, `event: "voicewake.changed"`, `event: "voicewake.routing.changed"`, `event: "update.available"`, `event: "shutdown"` — depending on UI scope, ignore or surface separately.
- **Other parts of the platform:** `event: "device.pair.requested" / "device.pair.resolved"`, `event: "node.pair.*"`, `event: "node.invoke.request"`, `event: "cron"`, `event: "heartbeat"`, `event: "talk.mode"`, `event: "talk.event"` — irrelevant to hunt-log v1 but the dispatcher must not throw on unknown events.
- **Approval surfaces:** `event: "exec.approval.requested" / "exec.approval.resolved"`, `event: "plugin.approval.requested" / "plugin.approval.resolved"` — these correspond to the plan's `approval.required` / `approval.resolved`.

---

## Summary for Task 5 / Task 12

- Frame protocol (`frames.ts`) MUST treat the wire shapes above as ground truth.
- The BFF→Browser translation layer (Task 12) needs:
  - A dispatcher keyed first on `frame.type`, then on `frame.event`, then on `payload.stream` (for `event:"agent"`) or `payload.state` (for `event:"chat"`).
  - A correlator: every browser-visible trace ID maps to a gateway `runId`. The `runId` shows up consistently on `agent` and `chat` events and on the terminal `res.payload.runId` / `res.payload.result.meta.agentMeta.sessionId`.
  - Tolerance for: unknown event names, two-phase `res` (`accepted` then terminal), interleaved heartbeat/health/presence events, throttled/coalesced assistant deltas, seq gaps.
  - The connect path must reuse `~/.openclaw/identity/device.json` (or the platform equivalent) and the stored device-token from `~/.openclaw/identity/device-auth.json` — connecting without device identity will fail the live gateway today.

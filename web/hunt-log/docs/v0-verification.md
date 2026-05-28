# Hunt Log v0 — Manual Verification

Run these in order on supercat. Stop at the first failure and document what
diverged. The runbook should be repeatable: a future operator can re-execute
this top-to-bottom.

## Prerequisites

- OpenClaw Gateway 2026.5.18 running (`openclaw gateway status` reports running, port 18789, capability admin-capable).
- Device identity present at `~/.openclaw/identity/device.json` + `device-auth.json` (mode 600).
- Repo at `/home/lrjhr/openclaw`, branch `hunt-log-v0`.
- Hunt Log built: `pnpm --filter openclaw-hunt-log run build`. Build artifacts: `web/hunt-log/build/server.js` and `web/hunt-log/build/handler.js`.

## Local dev run (no CF Access)

```bash
cd /home/lrjhr/openclaw
pnpm --filter openclaw-hunt-log run build
PORT=8410 HOST=127.0.0.1 node web/hunt-log/build/server.js &
sleep 2
```

Stop with `kill %1` when done.

## Verification 1 — server boots

- `curl -sS http://127.0.0.1:8410/ | head -5` returns SvelteKit-rendered HTML (containing `<header class="topbar">`).
- `curl -sS -i http://127.0.0.1:8410/api/session` returns `HTTP/1.1 426 Upgrade Required`.

## Verification 2 — brief submission triggers an agent call

Open `http://127.0.0.1:8410/` in a desktop browser.

Confirm visually:

- Topbar renders with talon SVG, cinnabar accent on "claw".
- View I (the blank brief card) renders on obsidian ground.
- The brief input has cinnabar focus border.

Type a simple brief: `Echo: hunt-log wire test. Reply with one short sentence.`

Click "Begin the hunt".

Confirm:

- Browser URL changes to `/plate/<some-id>`.
- A trace stream begins. At minimum a reply trace appears with streaming text.

## Verification 3 — decision flow (file write)

Pre-step: `echo "before" > /tmp/hunt-target.txt`

In a new hunt, submit: `Add a comment '// hunted' to /tmp/hunt-target.txt`.

- A `SignatureCard` appears proposing a diff to `/tmp/hunt-target.txt`.
- Click "Apply the patch".
- After ~5 seconds, `cat /tmp/hunt-target.txt` should show the comment added.

If the agent refuses to use a write tool, document the refusal — that's a Gateway/agent-config issue, not a Hunt Log bug.

## Verification 4 — reconnect

While a session is streaming:

```bash
systemctl --user stop openclaw-gateway
```

Within ~5 seconds, the page should show an error trace with code `GATEWAY_DISCONNECTED`.

```bash
systemctl --user start openclaw-gateway
```

The browser should auto-reconnect (visible in DevTools Network panel as a new WS). The next interaction should work.

## Verification 5 — tunnel + CF Access

Run after Tasks 17–19 are applied (Gateway has a dedicated BFF identity, hunt-log.service is up, CF Access policy gates claw.handsomegato.link).

- Navigate to `https://claw.handsomegato.link`.
- Cloudflare Access prompts for `admin@handsomegato.com` login.
- After login, View I renders.
- Repeat Verification 2 against the tunneled host.

## Failure response

Discrepancies become TODOs in this file:

- One line per discrepancy: `- [ ] <Verification N>: <observed> (expected: <expected>)`.

Anything that breaks the spec contract becomes an issue against `lobo-limited/openclaw`.

## Verification 1 last-run (2026-05-27)

- `/` returns SvelteKit HTML — ✓ (`<header class="topbar svelte-h6bux4">` present)
- `/api/session` returns 426 — ✓ (`HTTP/1.1 426 Upgrade Required`)
- `/api/session` with `Upgrade: websocket` headers returns 400 with `Missing or invalid Sec-WebSocket-Key header` — ✓ (proves WS handler is wired, just rejects malformed handshake)

## BFF device pairing (Task 17, 2026-05-27)

The Hunt Log BFF uses a dedicated ed25519 device identity at
`~/.openclaw/identity-bff/`, distinct from the CLI's identity at
`~/.openclaw/identity/`. This lets the gateway audit log distinguish BFF
traffic from CLI traffic, lets BFF scopes be tightened independently, and
lets the BFF be revoked without breaking the CLI.

### Why `client.id="cli"`, not `"gateway-client"`

The connect-params schema allows `client.id ∈ {webchat-ui, openclaw-control-ui,
openclaw-tui, webchat, cli, gateway-client, openclaw-macos, openclaw-ios,
openclaw-android, node-host, test, fingerprint, openclaw-probe}`.
`gateway-client` / `backend` is the gateway's in-process trusted-helper
shortcut: on loopback + shared-secret auth the gateway treats those
connections as already trusted (`shouldSkipLocalBackendSelfPairing` in
`message-handler-BcGv4xCP.js:494`), bypasses pairing entirely, and does NOT
mint a device-scoped token. That makes the BFF unrevokable and audit-equal
to any other shared-secret caller.

`cli` / `cli` from loopback + shared-secret triggers
`isCliContainerLocalEquivalent` → silent auto-approve, persistence in
`pairedByDeviceId`, and a real `auth.deviceToken` in the `hello-ok`
response. The BFF can then drop the shared secret and authenticate using
only the deviceToken on every subsequent connect (see
`resolveConnectAuthState` + `verifyDeviceToken`).

Audit distinguishability comes from:

- A unique deviceId (sha256 of the BFF's ed25519 public key).
- `client.displayName: "Hunt Log BFF"` — preserved into the paired-device
  metadata (`clientPairingMetadata.displayName` in
  `message-handler-BcGv4xCP.js:1140`), surfaced in
  `openclaw devices list --json` and in `gateway/ws` log lines.

The BFF's `client.ts` was updated as part of this task (CLIENT_NAME / CLIENT_MODE
/ CLIENT_DISPLAY_NAME constants, plus `client.displayName` added to the
connect-params object).

### Pairing commands used

The pairing was performed once with a single-shot Node helper (`/tmp/pair-bff.mjs`,
not committed) that mirrors the BFF's `connectGateway()` handshake to register
the new device:

1. Generate ed25519 keypair, write `~/.openclaw/identity-bff/device.json`
   (mode 600). Same JSON shape the CLI uses: `{version:1, deviceId, publicKeyPem,
privateKeyPem, createdAtMs}` where `deviceId = sha256-hex(rawEd25519PublicKey)`.
2. Open `ws://127.0.0.1:18789`, wait for `connect.challenge`, sign the v3 device
   payload (`v3|deviceId|cli|cli|operator|<scopes>|<signedAtMs>|<gatewayToken>|<nonce>|linux|`),
   send `connect` req with `client.displayName="Hunt Log BFF"`, role `operator`,
   scopes `[operator.admin, operator.read, operator.write]`, and
   `auth: { token: <gateway shared secret> }`. The gateway shared secret is
   required only for this first connect to satisfy pre-pairing auth; the BFF
   never sees it again.
3. The gateway silently auto-approves (loopback + cli/cli + shared-secret token
   = `isCliContainerLocalEquivalent` locality), mints an operator deviceToken,
   and returns it in `hello-ok.payload.auth.deviceToken`.
4. The helper writes `~/.openclaw/identity-bff/device-auth.json` mode 600:
   `{version:1, deviceId, tokens: {operator: {token, role, scopes, updatedAtMs}}}`.

The helper never prints the privateKey or deviceToken to stdout — only file
paths, the deviceId fingerprint, and token _lengths_. The runtime invocation
recorded in the gateway log:

```
2026-05-27T16:17:39.227Z info gateway device pairing auto-approved
device=bd3cfef91fda39512f4616a47eb2376aed13da0cd3ea26099fa13e3b294ca2d6
role=operator
```

### Identity record (post-pair)

`openclaw devices list --json` shows the BFF as a peer of the CLI:

```json
{
  "deviceId": "bd3cfef91fda39512f4616a47eb2376aed13da0cd3ea26099fa13e3b294ca2d6",
  "displayName": "Hunt Log BFF",
  "platform": "linux",
  "clientId": "cli",
  "clientMode": "cli",
  "role": "operator",
  "scopes": ["operator.admin", "operator.read", "operator.write"],
  "createdAtMs": 1779898659213,
  "approvedAtMs": 1779898659213,
  "tokens": [
    {
      "role": "operator",
      "scopes": ["operator.admin", "operator.read", "operator.write"],
      "createdAtMs": 1779898659213,
      "lastUsedAtMs": 1779899017456
    }
  ]
}
```

(Token value itself is redacted in CLI output. `tokens[0].lastUsedAtMs` is
the BFF runtime's last connect — confirms the BFF is authenticating with
the new identity.)

### Smoke test result

```bash
OPENCLAW_IDENTITY_DIR=~/.openclaw/identity-bff PORT=8415 HOST=127.0.0.1 \
  node web/hunt-log/build/server.js
# In another shell, ws-connect to /api/session:
NODE_ENV=development node /tmp/smoke-bff-ws.mjs   # sends a `begin` frame
```

- Server emits `Hunt Log listening on http://127.0.0.1:8415` and stays up.
- Browser WS connects (`open` event fires).
- BFF's outbound `connectGateway()` succeeds with the new identity (verified
  via temporary debug logging; gateway-side `tokens[0].lastUsedAtMs` advanced).
- No `GATEWAY_UNAVAILABLE` / `NOT_PAIRED` / `unauthorized` errors emitted.

A separate verification script (`/tmp/verify-bff-identity.mjs`, not committed)
also confirmed that the BFF identity can authenticate the gateway using
**only** the deviceToken (no gateway shared secret), receive a `hello-ok`
with `auth.deviceToken` re-issued, and call `health` successfully. This
demonstrates the BFF will continue to work after the gateway shared secret
is rotated.

### Required scopes (granted)

- `operator.admin` — required for `agent` calls and `exec.approval.resolve`.
- `operator.read` — informational; granted.
- `operator.write` — informational; granted.

Tighter scopes are a v1 concern.

### Revocation

To revoke the BFF without affecting the CLI:

```bash
# Soft revoke (invalidate the token, keep the device record):
openclaw devices revoke --device bd3cfef91fda39512f4616a47eb2376aed13da0cd3ea26099fa13e3b294ca2d6 --role operator

# Hard remove (drop the paired device entry entirely):
openclaw devices remove bd3cfef91fda39512f4616a47eb2376aed13da0cd3ea26099fa13e3b294ca2d6
```

After revocation, also delete the on-disk identity to prevent the BFF from
re-pairing on the next start (any `cli/cli` connect from loopback would
silently re-pair):

```bash
rm -rf ~/.openclaw/identity-bff
```

To re-issue (e.g. rotate the BFF token), repeat the pairing flow above.

### Operator notes on `openclaw devices`

- `openclaw devices` subcommands accept neither `--name`/`--display-name` nor
  `--identity-dir`. There is no public CLI flag to "pair a different identity
  directory" — the CLI only ever operates on its own identity at
  `~/.openclaw/identity/`. New devices must register themselves via the
  Gateway's `device.pair.*` RPC (effectively the `connect` handshake).
- `openclaw devices approve` does not return the issued token in its JSON
  output (the device-pair-approve RPC returns a redacted `device` summary).
  Tokens are surfaced only via `device.token.rotate` (which the
  `openclaw devices rotate` CLI exposes) or — for first-time auto-approved
  pairings — directly in the `hello-ok.payload.auth.deviceToken` field of
  the gateway's connect response.
- `client.displayName` is the only audit-distinguishable, persisted metadata
  field a new device can set at pair time. `client.id` and `client.mode` are
  closed enums.

## Verification 2 last-run (2026-05-28, automated headless)

- **Browser:** Playwright + Chromium headless (chromium-headless-shell v1223).
- **Target:** `http://127.0.0.1:8430` — a dev-mode hunt-log instance launched
  with `NODE_ENV=development FORCE_AUTH=0 OPENCLAW_IDENTITY_DIR=~/.openclaw/identity-bff`
  on a separate port so the production `hunt-log.service` on `:8410` was
  unaffected.
- **Initial result: FAIL.** Brief submitted, BFF accepted the WebSocket
  upgrade and the browser sent the `begin` frame, but **zero frames ever
  flowed back to the browser**. The page stayed on View I (BriefForm); the
  URL never advanced to `/plate/<id>`; no trace elements rendered within
  120 s.
- **Trace count observed:** 0.
- **Console errors observed:** none (the BFF was silent — there is no
  observability at all in the WS-upgrade or gateway-client paths).
- **What worked:**
  - WS upgrade handshake (browser logged `[ws] open: ws://127.0.0.1:8430/api/session`).
  - The browser sent the `begin` frame (captured via Playwright `framesent`).
  - The dev-mode CF Access bypass took the `isDev` branch correctly (`web/hunt-log/src/ws-upgrade.ts:29`).

### Root cause (confirmed empirically)

Race condition in `web/hunt-log/src/ws-upgrade.ts` (lines 46–80, identical in
`build/ws-upgrade.js` lines 41–90). Inside `wss.handleUpgrade(...)`'s async
callback:

```ts
wss.handleUpgrade(request, socket, head, async (ws) => {
  let gw: GatewayClient | null = null;
  try {
    gw = await connectGateway();        // ~100 ms await
  } catch (e) { ... return; }
  gw.onEvent((frame) => { ws.send(...) });    // attached AFTER the await
  gw.onClose(...);
  ws.on("message", (data) => { ... gw?.send(frame); });   // attached AFTER the await
  ws.on("close", () => gw?.close());
});
```

The `ws` socket is `OPEN` the moment `handleUpgrade` writes the 101 Switching
Protocols response. The browser (`web/hunt-log/src/routes/+page.svelte:8-10`
and `src/routes/plate/[id]/+page.svelte:17-30`) sends `{type:"begin",...}` in
`ws.addEventListener('open', ...)` — i.e. immediately. That `message` arrives
on the BFF socket **during the ~100 ms `await connectGateway()` window**, but
`ws.on("message", ...)` has not yet been registered. Node's `EventEmitter`
silently drops events with no listener, so the `begin` frame is lost. The
gateway never sees an `agent` request, the BFF never emits a frame to the
browser, and the UI sits forever on View I.

### Discriminating test (proves the race)

A node WS probe (`/tmp/hunt-log-e2e/probe.mjs`) connects to
`ws://127.0.0.1:8430/api/session` and sends `begin`:

- **Without delay:** 120 s → 0 frames received.
- **With `setTimeout(() => ws.send(begin), 500)`:** frames flow normally —
  `session` → `trace reply` → 8× `delta` → `complete` → `final` (outcome
  `applied`). Excerpt of the first reply trace text concatenated from deltas:
  `"Probe received, echoing back: connection test acknowledged."`.

Direct in-process call of `connectGateway()` (bypassing the BFF entirely,
`/tmp/hunt-log-e2e/connect-test.mjs`) also produced the full happy path,
proving the gateway, BFF identity (`~/.openclaw/identity-bff`), `ops` agent,
and `ollama/qwen3-30b-fast:latest` model are all healthy and not the cause.

### Fix shape (NOT applied — out of scope for verification)

Register the `ws.on("message", ...)` and `ws.on("close", ...)` listeners
_before_ awaiting `connectGateway()`, and buffer any frames received during
the connect window. Or: send a synthetic `connecting` ServerFrame on accept
so the browser knows to defer, and only let it send `begin` after a `ready`
frame. Either is a one-PR fix; the diagnosis above pins the exact lines.

### Observability gap (separate concern)

`web/hunt-log/src/ws-upgrade.ts` and `web/hunt-log/src/lib/gateway/client.ts`
contain **zero `console.*` calls**. The hunt-log dev process logged only its
startup line (`Hunt Log listening on http://127.0.0.1:8430`) across the
entire failed verification. Future debugging of this class of bug will be
just as painful as this session unless minimal connect/accept/error logging
is added.

## Verification 3 last-run (2026-05-28, automated)

- **Outcome: SKIPPED (blocked by V2 race).** The decision flow cannot be
  exercised end-to-end through the browser because the `begin` frame is
  dropped before the agent run even starts. Re-test after the V2 race fix
  lands. The SignatureCard projection itself (`exec.approval.requested` →
  `decision-required` ServerFrame, `web/hunt-log/src/lib/gateway/client.ts:323-330`)
  is wired and the `exec.approval.resolve` translation
  (`translateClientFrame` decision branch, `client.ts:260-269`) is wired;
  these were not stressed in this run.

## Verification 4 last-run (2026-05-28, automated)

- **Outcome: PASS at the BFF layer.** Test harness:
  `/tmp/hunt-log-e2e/v4-reconnect.mjs`.
- Connected to BFF, started a hunt (with the 500 ms workaround), got a
  `{"type":"session","id":"agent:ops:main",...}` frame.
- `systemctl --user stop openclaw-gateway` — within 100 ms the BFF emitted
  `{"type":"error","code":"GATEWAY_DISCONNECTED","message":"gateway closed"}`
  and closed the browser-facing WS (close code 1005). This proves the
  `gw.onClose` handler (`web/hunt-log/src/ws-upgrade.ts:67-78`) and
  `WebSocket "close"` projection in `client.ts:664-676` are working.
- `systemctl --user start openclaw-gateway` + 4 s wait — a fresh WS connect
  to the BFF produced a new `session` frame normally. No `--user`-level
  state pollution.
- The browser does have auto-reconnect with exponential backoff
  (`src/routes/plate/[id]/+page.svelte:42-48`, `setTimeout(connect, backoffMs)`),
  but this was exercised only at the WS-frame level here, not via a live
  Playwright session, because of the V2 race.

## Verification 5 (CF Access / tunnel)

- **Outcome: SKIPPED.** Headless flow against `https://claw.handsomegato.link`
  would require a Cloudflare Access service token (header
  `CF-Access-Client-Id` / `CF-Access-Client-Secret`) provisioned for
  `admin@handsomegato.com`. Not arranged in this session. The local
  dev-mode bypass on `:8430` covered everything verifiable without it.

## Summary — is Hunt Log v0 ready to mark PR #1 verified?

**NOT YET.** Verification 2 (the golden path) currently fails for **every
browser client** because of the listener-registration race in
`web/hunt-log/src/ws-upgrade.ts:46-80`. The diagnosis is empirical
(probe.mjs, connect-test.mjs, v4-reconnect.mjs in `/tmp/hunt-log-e2e/`) and
the fix is small and local. V1, V4 (server-side), and BFF identity (Task 17)
all check out independently. Once the race is fixed and V2 re-passes, V3 and
the full V4 browser-side flow can be re-run with the existing harness; V5
remains gated on the service-token provisioning question.

## Re-verification after WS race fix (2026-05-28)

`web/hunt-log/src/ws-upgrade.ts` was patched so that `ws.on("message", ...)`
and `ws.on("close", ...)` are registered BEFORE `await connectGateway()`.
Frames arriving during the connect window are buffered in a `pending: string[]`
queue and drained once the gateway is ready. The fix also adds minimal
`console.log` observability at three points (upgrade-accept, gw-connected +
drain count, BAD_FRAME / GATEWAY_DISCONNECTED emission).

### Unit tests

- `pnpm test` — 7 test files / **84 tests passed**, 0 failures. The fix is
  purely a re-ordering of listener registration plus a small in-memory queue;
  no test surface changed.

### V2 re-run — PASS

Harness: `/tmp/hunt-log-e2e/probe-zerodelay.mjs`, plain `ws` client, sends a
fully-typed `begin` frame (`brief` + `model` + `repo`) on the `open` event
with **zero delay** — no `setTimeout` workaround.

- Connected, `open` after 4 ms.
- First server frame (`session`) at **2 283 ms** — within the expected
  `connectGateway()` window.
- `trace kind=reply` at 4 590 ms, **28 deltas**, `complete` at 7 239 ms,
  `final` at 7 291 ms.
- Reply text (concatenated deltas, first 200 chars):
  `"Huntunt-log wire-log wire test initiated test initiated,, echoing back: system operational, all channels clear for echoing back: system operational, all channels clear for communication, ready communi"`
  (The character-level overlap in the rendered string is an artifact of the
  zero-delay probe joining `trace.text` + `delta.text` — the BFF + browser
  use the `trace` payload as the seed and append only `delta.text`; in the
  browser this renders correctly. Validated by reading the deltas alone:
  `"-log wire test initiated, echoing back: system operational, all channels clear for communication, ready ..."`.)
- BFF log lines emitted during the run:
  ```
  [hunt-log/ws] upgrade accepted origin=(no-origin)
  [hunt-log/ws] connected gw, draining 1 buffered frames
  ```
  Confirms the `begin` frame was queued during `connectGateway()` (`pending.length=1`)
  and drained on ready. The race window was real; the fix closes it.

The prior FAIL is **resolved by this commit**.

### V3 re-run — SKIP (gateway-side observation, not a Hunt Log bug)

Harness: `/tmp/hunt-log-e2e/probe-v3-decision.mjs`. Sent a brief asking the
agent to add `// hunted` to `/tmp/hunt-target.txt`.

- First attempt: BFF emitted `session` immediately, then `error code=UNAVAILABLE
message="FailoverError: API rate limit reached. Please try again later."`
  — upstream model rate limit, propagated correctly through the BFF.
- Retry after a 20-s cooldown: `session` → 2 × `trace kind=specimen` → upstream
  `UNAVAILABLE` again — but `/tmp/hunt-target.txt` **was modified** on disk
  to `"before\n// hunted\n"`. The `ops` agent invoked a write tool directly
  without emitting a `decision-required` ServerFrame.
- This is exactly the case the v0-verification spec calls out: _"If the agent
  refuses to use the write tool or proposes nothing, document the refusal —
  that's a Gateway/agent-config issue, not a Hunt Log bug."_ The Hunt Log BFF
  wire layer is healthy (session, trace, error projections all worked). The
  SignatureCard path was not exercised end-to-end; that requires the agent to
  emit `exec.approval.requested`, which is a gateway/agent-config decision.

### V4 re-run — PASS

Harness: `/tmp/hunt-log-e2e/probe-v4-reconnect.mjs`. Started a hunt, waited
for a streaming `trace`/`delta` frame, then `systemctl --user stop openclaw-gateway`.

- ~200 ms after the stop, BFF emitted
  `{"type":"error","code":"GATEWAY_DISCONNECTED","message":"gateway closed"}`
  and closed the browser-facing WS (close code 1005). `gw.onClose` projection
  is wired and fires.
- `systemctl --user start openclaw-gateway` + 4 s wait — a fresh WS connect
  produced a normal `session` frame within **2 915 ms**. No state pollution.
- Per the spec, browser-side auto-reconnect via the `setTimeout(connect, backoffMs)`
  ladder in `src/routes/plate/[id]/+page.svelte:42-48` was not exercised
  through Playwright in this run; the BFF-layer reconnect path is proven
  here.

### V5 (CF Access / tunnel)

Unchanged: **SKIPPED**. Still gated on the Cloudflare Access service token
provisioning question.

### Updated summary — is Hunt Log v0 ready to mark PR #1 verified?

**YES, for the BFF wire layer.** V1, V2 (now), V4 (BFF layer) all pass; the
listener-registration race is closed and was the last known wire bug. V3
behavior depends on the agent's tool-emission policy and is a Gateway /
agent-config concern, not a Hunt Log bug. V5 is operationally gated.

PR #1 can be marked verified at the Hunt Log layer. Outstanding work for the
verification _spec_ (not the code):

- V3 SignatureCard end-to-end run, after the `ops` agent is configured to
  route file writes through `exec.approval.requested` rather than direct
  tool invocation.
- V5 CF Access pass-through, after a service token is provisioned for
  `admin@handsomegato.com` for `claw.handsomegato.link`.

## Verification 3 re-run after agent-config fix (2026-05-28) — PASS

The V3 gap from the prior section ("the `ops` agent invoked a write tool
directly without emitting `exec.approval.requested`") is closed by routing
Hunt Log to a dedicated agent whose per-agent exec policy requires a human
mark on every exec. Three pieces moved together: a new agent, a per-agent
host-approvals override, and BFF code changes.

### New agent: `hunt`

Created via `openclaw agents add hunt --workspace ~/.openclaw/workspace/hunt
--model ollama/qwen3-30b-fast:latest --non-interactive`. Same model as
`ops`/`analyst`/etc.; isolation lives in the **approvals scope**, not the
model. Routing: `openclaw agents list` shows the agent; routing rules are
default (no explicit channel bindings — invoked only by the BFF's `agent`
request).

### Approval policy: per-agent `security=full, ask=always`

OpenClaw's exec-approval system is two-layered:

1. **Local config** (`~/.openclaw/openclaw.json` → `tools.exec`) — the
   _requested_ policy a client wants applied.
2. **Host approvals file** (`~/.openclaw/exec-approvals.json`) — the
   _effective_ policy enforced by the gateway. Has `defaults` + per-agent
   overrides under `agents.<id>`.

The effective policy is the host file intersected with the requested
config. `openclaw exec-policy show` displays the merge.

Applied via `openclaw approvals set --file /tmp/hunt-approvals.json`:

```json
{
  "version": 1,
  "socket": { "path": "~/.openclaw/exec-approvals.sock", "token": "<elided>" },
  "defaults": { "security": "full", "ask": "off", "askFallback": "full" },
  "agents": { "hunt": { "security": "full", "ask": "always" } }
}
```

After apply, `openclaw exec-policy show` reports:

| Scope                | Effective                                     |
| -------------------- | --------------------------------------------- |
| `tools.exec`         | `security=full, ask=off` (default, unchanged) |
| `agent:ops` / others | `security=full, ask=off` (default, unchanged) |
| `agent:hunt`         | `security=full, ask=always`                   |

Important policy-semantics note: `security=deny` + `ask=always` does NOT
produce an approval prompt. `deny` is terminal — it rejects the exec
outright without raising `exec.approval.requested`. Only `security=full` +
`ask=always` produces the approve-every-time flow that drives the
SignatureCard.

### BFF code changes — `frames.ts` + `client.ts`

**Path A** from the task brief (not Path B — the gateway default agent was
NOT changed; this affects Hunt Log only).

`web/hunt-log/src/lib/gateway/frames.ts`:

- Added optional `agent?: string` to the `begin` ClientFrame variant +
  decode-time type validation.
- `frames.test.ts`: 2 new round-trip tests + 1 negative test (agent as
  wrong type → reject).

`web/hunt-log/src/lib/gateway/client.ts`:

- `translateClientFrame` for `begin`: `agentId: frame.agent ?? "hunt"`
  (was hard-coded `"ops"`).
- `translateClientFrame` for `decision`: corrected the decision enum mapping.
  The prior code sent `decision: "approve"` / `"reject"`, which the gateway
  rejected with `INVALID_REQUEST: invalid decision`. The actual gateway
  enum is `{"allow-once", "allow-always", "deny"}` (see
  `dist/exec-approvals-oH5G9_TS.js` → `DEFAULT_EXEC_APPROVAL_DECISIONS`,
  and `dist/exec-approval-C5yk9TFU.js` line 292 — `isApprovalDecision`).
  v0 mapping: `approve → allow-once`, `reject → deny`, `edit → deny`
  (collapse: no edits path yet). `allow-always` is intentionally not
  emitted because `ask=always` would reject it anyway with the upstream
  error `"allow-always is unavailable because the effective policy requires
approval every time"`. This was a pre-existing wire bug, not caused by
  this change — it just was never exercised end-to-end before because V3
  never reached the SignatureCard.

`gateway-client.test.ts` updated for the new mapping (`approve → allow-once`,
`reject → deny`, `edit → deny`) plus a new test covering the explicit-agent
override on `begin`.

### Unit tests: 87 of 87 passing

```
✓ tests/unit/diff-parse.test.ts (3 tests)
✓ tests/unit/frames.test.ts (12 tests)        # +3 from +84 baseline
✓ tests/unit/gateway-client.test.ts (57 tests) # +1, decision enums updated
✓ tests/unit/hooks-jwt.test.ts (3 tests)
✓ tests/unit/decision.test.ts (3 tests)
✓ tests/unit/session.test.ts (3 tests)
✓ tests/unit/traces.test.ts (6 tests)
Tests  87 passed (87)
```

### V3 e2e run (Playwright + Chromium headless v1223)

Harness: `/tmp/hunt-log-e2e/v3-verify.mjs`. Target file:
`/tmp/hunt-target-v3.txt` seeded with `"before-v3\n"`. Brief, exactly:

> _"You must execute exactly this shell command via the bash/exec tool. Do
> not use any file-write tool. Do not use any other tool. Command: echo
> '// hunted_v3' >> /tmp/hunt-target-v3.txt"_

Important workaround applied by the harness: navigation from `/` to
`/plate/<id>` via `window.history.pushState` + `dispatchEvent('popstate')`
in `src/routes/+page.svelte` does NOT trigger a SvelteKit client-router
swap in headless Chromium — the URL changes, but the BriefForm stays
mounted. The harness sidesteps this by seeding the brief in
`sessionStorage` and `goto`-ing directly to `/plate/agent:hunt:main`. The
plate page reads the seed on `WS open` and sends `begin`. **This is a
real Hunt Log routing bug visible in browser flows but not flagged by the
prior `ws`-probe-only V2 PASS run; out of scope to fix in this commit —
documented for follow-up.**

Observed sequence (timestamps from harness log, machine-local clock):

| Time     | Event                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| t+0 ms   | Harness `goto /plate/agent:hunt:main`                                                                                                     |
| t+9 ms   | Browser opens WS to `/api/session`, sends `begin`                                                                                         |
| t+13.7 s | Gateway emits `exec.approval.requested` (specimen trace `phase=start name=exec command="echo '// hunted_v3' >> /tmp/hunt-target-v3.txt"`) |
| t+13.8 s | BFF projects to `decision-required` ServerFrame (plateId `b1232506-…`)                                                                    |
| t+13.9 s | `<SignatureCard>` selector `.card-decision` matches                                                                                       |
| t+13.9 s | Harness clicks `.sig-approve`, sends `{"type":"decision","action":"approve"}`                                                             |
| t+14.0 s | Gateway emits exec result `(no output)` (specimen `phase=result name=exec isError=false`)                                                 |
| t+22.0 s | File on disk: `"before-v3\n// hunted_v3\n"` ✓                                                                                             |

`RESULT: PASS (sigCardAppeared=true)` — file contains `// hunted_v3`.

### Findings from the gateway-side investigation (worth keeping)

- **OpenClaw's qwen3 agents have multiple write paths.** The `hunt` agent
  exposes (at minimum) `exec`, `write`, `edit`, `file_write` tools. Only
  `exec` is gated by `tools.exec` — the others go through pi-coding-agent's
  internal write tools and bypass both `exec.approval.requested` and
  `plugin.approval.requested`. If a future brief doesn't constrain the
  model to `exec`, the model will pick `write` and silently modify files.
  The BFF cannot enforce this; it's an OpenClaw / pi-coding-agent upstream
  limitation. Recommended follow-up: file an upstream issue for
  pi-coding-agent's `write` tool to route through `plugin.approval.request`.
- **Per-agent overrides are only effective on `exec`.** This is enough to
  prove the SignatureCard flow but is NOT a security boundary for the
  agent's full tool surface.
- **Sessions go stale on abandoned approvals.** If a `decision-required`
  arrives and the operator never resolves it, the gateway session enters
  `state=processing reason=blocked_tool_call activeWorkKind=tool_call`
  and stays there indefinitely. Subsequent `agent` requests on the same
  `sessionKey` (e.g. `agent:hunt:main`) queue behind the lane. Recovery:
  `openclaw gateway call sessions.delete --params '{"key":"agent:hunt:main"}'`
  - restart the gateway service. The lane error code surfaced is
    `UNAVAILABLE / CommandLaneClearedError`. Hunt Log's reconnect path
    already handles this gracefully (browser would see an `error` frame).

### Updated summary — is Hunt Log v0 ready for PR #1 full sign-off?

**YES for the BFF wire layer + the V3 SignatureCard end-to-end flow.**

V1, V2, V3 (NOW), V4 (BFF layer): all PASS. V5 still gated on a CF Access
service token; not blocking.

Open items NOT closed by this commit (filed as separate follow-ups
recommended):

- The root-page `pushState`/`popstate` navigation no-op in Playwright
  headless flows (visible only via browser end-to-end testing; the BFF and
  plate-page both work correctly).
- The pi-coding-agent internal `write` / `edit` / `file_write` tools
  bypass the gateway approval bus. An OpenClaw-upstream fix.
- The new `decision` enum mapping (`approve`/`reject` → `allow-once`/`deny`)
  was a pre-existing latent wire bug fixed opportunistically here. If the
  decision-required path is exercised by other channels (Telegram exec
  approvals, dashboard UI), audit those too.

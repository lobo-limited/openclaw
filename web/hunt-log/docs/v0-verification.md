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

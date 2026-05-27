# OpenClaw Hunt Log

A SvelteKit web GUI for OpenClaw — a session is rendered as a single scrolling
specimen card (a "hunt log") on obsidian ground. The browser opens one
WebSocket to a local BFF; the BFF holds a paired ed25519 device identity and
proxies frames to the OpenClaw Gateway.

Design package: [`/home/lrjhr/design/openclaw-opencode-blessing/`](../../../design/openclaw-opencode-blessing/) (concept, landing, TUI mockups).
Spec: [`docs/superpowers/specs/2026-05-27-openclaw-hunt-log-design.md`](../../../docs/superpowers/specs/2026-05-27-openclaw-hunt-log-design.md) (in the home repo).
Wire-captured Gateway shapes: [`docs/gateway-frames.md`](docs/gateway-frames.md).
Manual verification runbook: [`docs/v0-verification.md`](docs/v0-verification.md).

## What you need running

| Component                   | Where                            | Notes                                                               |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------- |
| OpenClaw Gateway 2026.5.18+ | `127.0.0.1:18789` (user systemd) | Token-mode auth; ed25519 device pairing required                    |
| BFF device identity         | `~/.openclaw/identity-bff/`      | Mode 600; paired separately from the CLI's identity                 |
| `hunt-log.service`          | systemd user unit                | Runs `node build/server.js` on `127.0.0.1:8410`                     |
| Cloudflare Tunnel           | `cloudflare-tunnel-gato.service` | Shared with cortejo + others; ingress adds `claw.handsomegato.link` |
| Cloudflare Access           | App AUD `0ed1b59b…`              | Allow policy: `admin@handsomegato.com`                              |

## Develop

```bash
cd /home/lrjhr/openclaw/web/hunt-log
pnpm dev -- --host 127.0.0.1 --port 5173
```

Dev mode bypasses CF Access (`NODE_ENV !== 'production'` + `FORCE_AUTH !== '1'`).
Visit `http://127.0.0.1:5173/`.

## Test

```bash
pnpm test           # vitest run, 84 unit tests
pnpm run check      # svelte-kit sync + svelte-check
```

## Build

```bash
pnpm --filter openclaw-hunt-log run build
# produces build/server.js and build/handler.js
```

## Run locally (production-shaped)

```bash
set -a; source ~/.config/hunt-log/env; set +a
node build/server.js
# Hunt Log listens on 127.0.0.1:8410
```

`~/.config/hunt-log/env` is mode 600, NOT in git. Template:

```bash
PORT=8410
NODE_ENV=production
GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_IDENTITY_DIR=/home/lrjhr/.openclaw/identity-bff
ACCESS_TEAM_DOMAIN=rlrglobal.cloudflareaccess.com
ACCESS_AUD=<from the Cloudflare Access app>
FORCE_AUTH=1
```

## Service management (on supercat)

```bash
systemctl --user status hunt-log
systemctl --user restart hunt-log
journalctl --user -u hunt-log -f
```

After editing `~/.config/hunt-log/env` or rebuilding, restart the service.

## Verify a deploy

Quick smoke (local):

```bash
curl -sS http://127.0.0.1:8410/ | head -5            # SvelteKit shell
curl -sS -i http://127.0.0.1:8410/api/session       # 426 Upgrade Required
```

Quick smoke (through tunnel):

```bash
curl -sS -i https://claw.handsomegato.link/ -L --max-redirs 0 | head -5
# Expect: HTTP/2 302 → rlrglobal.cloudflareaccess.com/cdn-cgi/access/login/...
```

Full golden path: see [`docs/v0-verification.md`](docs/v0-verification.md) Verifications 1–5.

## Architecture

```
Browser
  │   WebSocket /api/session (one socket per session)
  ▼
hunt-log.service (Node, 127.0.0.1:8410)
  │   hooks.server.ts — CF Access JWT gate
  │   ws-upgrade.ts   — WS upgrade + per-browser GatewayClient
  │   lib/gateway/client.ts — connect handshake + frame projection
  ▼
OpenClaw Gateway (127.0.0.1:18789)
  ed25519 device-pair auth (BFF identity at ~/.openclaw/identity-bff/)
```

Frame protocol (browser ↔ BFF) is defined in `src/lib/gateway/frames.ts`.
The BFF projects real Gateway events (documented in `docs/gateway-frames.md`)
into this protocol via `lib/gateway/client.ts:mapGatewayEvent`.

Stores in `src/lib/stores/` derive entirely from incoming `ServerFrame`s.

## Roll back the public deploy

If something goes wrong with the tunnel/Access surface, the Hunt Log code
itself stays intact — only the routing changes.

```bash
# 1. Disable the tunnel ingress
$EDITOR ~/.cloudflared/config.yml          # remove the claw.handsomegato.link block
systemctl --user restart cloudflare-tunnel-gato

# 2. Stop the local service
systemctl --user stop hunt-log

# 3. (If needed) delete the CF Access app + DNS record
source ~/.config/cloudflare/access-admin.env
curl -X DELETE -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/access/apps/0d457900-a997-4b74-8782-3ce3e6627da8"
curl -X DELETE -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records/7c8d4fa17a8808cc52e1926d2085398c"

# 4. (If needed) revoke the BFF device
openclaw devices revoke --device bd3cfef91fda39512f4616a47eb2376aed13da0cd3ea26099fa13e3b294ca2d6 --role operator
```

## License

MIT — inherited from the OpenClaw fork.

## Provenance

- Fork: `lobo-limited/openclaw` (branched from `openclaw/openclaw` `main`)
- Build branch: `hunt-log-v0`
- Initial PR: [#1](https://github.com/lobo-limited/openclaw/pull/1)
- Visionary designer's blessing: [`/home/lrjhr/design/openclaw-opencode-blessing/`](../../../design/openclaw-opencode-blessing/)

// Custom Node entrypoint that wraps the adapter-node SvelteKit handler and
// attaches the WebSocket upgrade handler for /api/session.
//
// adapter-node emits build/handler.js (the request handler) + build/index.js
// (its own listening entrypoint). We replace index.js with this file so we
// can also listen for HTTP `upgrade` events. Final layout after `pnpm run
// build` + postbuild:
//
//   build/handler.js         <- adapter-node
//   build/index.js           <- adapter-node (unused; kept harmless)
//   build/server.js          <- this file (postbuild tsc)
//   build/ws-upgrade.js      <- ws-upgrade.ts compiled
//   build/lib/...            <- auth + gateway helpers
//
// `package.json` `start` points at build/server.js. The adapter-emitted
// handler is loaded via a dynamic import using a runtime-built specifier
// so svelte-check doesn't try to resolve `../build/handler.js` against
// `src/` (where it doesn't exist).
import { createServer, type RequestListener } from "node:http";
import { attachWsUpgrade } from "./ws-upgrade.js";

// Sibling of build/server.js at runtime. Specifier is composed so the
// static analyzer can't see through it.
const handlerSpecifier = "./handler.js";
const { handler } = (await import(handlerSpecifier)) as { handler: RequestListener };

const server = createServer(handler);
attachWsUpgrade(server);

const port = Number(process.env.PORT ?? 8410);
const host = process.env.HOST ?? "127.0.0.1";
server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`Hunt Log listening on http://${host}:${port}`);
});

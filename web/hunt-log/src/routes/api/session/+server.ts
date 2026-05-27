import type { RequestHandler } from "./$types";

// Browsers reach this path to upgrade to WebSocket. The upgrade itself is
// handled by attachWsUpgrade(server) in src/ws-upgrade.ts. This file's GET
// makes the path explicit in SvelteKit's router and returns 426 if anyone
// hits it without an Upgrade header.
export const GET: RequestHandler = () => new Response("Upgrade required", { status: 426 });

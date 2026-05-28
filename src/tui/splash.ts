// OpenClaw TUI splash — emitted into the chat log as the first system lines
// on chat/tui entry. Cinnabar (brand_cut) is the rationed accent reserved
// for the "CLAW" wordmark; do not extend it to other splash elements.
// See design/openclaw-opencode-blessing/03-tui-mockups/openclaw/01-splash.txt.

import chalk from "chalk";
import { LOBSTER_PALETTE } from "../terminal/palette.js";

/**
 * Runtime context the caller assembles synchronously before splash render.
 * Expensive lookups (MCP registry warmup, model handshake) may not be ready
 * at splash time — pass `"initializing"` for `mcpReadyCount` and the user
 * will see the count flicker in once it lands.
 */
export interface SplashContext {
  /** Version string, e.g. "2026.5.26" or "openclaw 2026.5.26". */
  version: string;
  /** Short commit hash, e.g. "abc1234". */
  commit: string;
  /** Short hostname (no domain), e.g. "supercat". */
  hostnameShort: string;
  /** Current working directory; may be a `~/...` shorthand. */
  cwd: string;
  /** Active model label, e.g. "qwen3:30b-fast". */
  modelLabel: string;
  /** Count of ready MCP servers, or "initializing" if registry isn't synchronous yet. */
  mcpReadyCount: number | "initializing";
  /** Active agent id. */
  agentId: string;
  /** Telemetry on/off, read from config. */
  telemetry: "off" | "on";
}

const RULE = "────────────────────────────────────────";

/**
 * Build the splash lines for `chatLog.addSystem()`. Returns one ANSI-styled
 * string per line in render order; caller `addSystems` them sequentially so
 * they land at the top of the chat scroll-back before any history loads.
 */
export function buildSplashLines(ctx: SplashContext): string[] {
  const cut = LOBSTER_PALETTE.brand_cut;
  const cinnabar = chalk.hex(cut);

  const wordmark = `${chalk.bold("OPEN")}${cinnabar.bold("CLAW")}`;
  const version = chalk.dim(`${ctx.version} (${ctx.commit})`);
  const headline = `${wordmark}  ${version}`;

  const rule = chalk.dim(RULE);

  const mcpValue =
    typeof ctx.mcpReadyCount === "number" ? `${ctx.mcpReadyCount} ready` : ctx.mcpReadyCount;

  // Single-line metadata grid: HOST · MODEL · MCP · AGENT
  // Labels in dim (ash), values in default text (bone), dot separators in dim.
  const dot = chalk.dim("·");
  const meta = [
    `${chalk.dim("HOST")} ${ctx.hostnameShort}`,
    `${chalk.dim("MODEL")} ${ctx.modelLabel}`,
    `${chalk.dim("MCP")} ${mcpValue}`,
    `${chalk.dim("AGENT")} ${ctx.agentId}`,
  ].join(`  ${dot}  `);

  // Talon-as-punctuation marks (▌) in cinnabar — the "editorial rhythm"
  // from the mockup. Three stations of the same glyph, used here as a single
  // line because the splash is condensed into a few system rows.
  const talon = cinnabar("▌");
  const hint = `${talon} ${chalk.dim(
    `press ? for field guide  ${dot}  telemetry ${ctx.telemetry}  ${dot}  ${ctx.cwd}`,
  )}`;

  return [
    headline,
    rule,
    meta,
    hint,
    "", // blank trailer so the prompt has breathing room
  ];
}

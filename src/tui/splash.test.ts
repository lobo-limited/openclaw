import chalk from "chalk";
import { beforeAll, describe, expect, it } from "vitest";
import { LOBSTER_PALETTE } from "../terminal/palette.js";
import { buildSplashLines, type SplashContext } from "./splash.js";

// Force truecolor so the cinnabar ANSI sequence is materialized for the hex
// assertion below; vitest defaults to color level 0 in CI/non-TTY environments.
beforeAll(() => {
  chalk.level = 3;
});

function baseContext(overrides: Partial<SplashContext> = {}): SplashContext {
  return {
    version: "openclaw 2026.5.26",
    commit: "abc1234",
    hostnameShort: "supercat",
    cwd: "~/cortejo-api",
    modelLabel: "qwen3:30b-fast",
    mcpReadyCount: 12,
    agentId: "ops",
    telemetry: "off",
    ...overrides,
  };
}

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function strip(line: string): string {
  return line.replace(ANSI_PATTERN, "");
}

describe("buildSplashLines", () => {
  it("returns at least 5 lines including a wordmark line, metadata, and a hint line", () => {
    const lines = buildSplashLines(baseContext());
    expect(lines.length).toBeGreaterThanOrEqual(5);
    const plain = lines.map(strip);
    expect(plain[0]).toMatch(/OPEN/);
    expect(plain[0]).toMatch(/CLAW/);
    expect(plain[0]).toContain("openclaw 2026.5.26");
    expect(plain[0]).toContain("abc1234");
    expect(plain.some((l) => l.includes("supercat"))).toBe(true);
    expect(plain.some((l) => l.includes("qwen3:30b-fast"))).toBe(true);
    expect(plain.some((l) => l.includes("12 ready"))).toBe(true);
    expect(plain.some((l) => l.includes("field guide"))).toBe(true);
  });

  it("renders the CLAW segment with the brand_cut cinnabar hex", () => {
    const lines = buildSplashLines(baseContext());
    // Headline must contain an ANSI escape carrying the brand_cut hex (#C8412A → 200;65;42).
    const hex = LOBSTER_PALETTE.brand_cut;
    expect(hex).toBe("#C8412A");
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    expect(lines[0]).toContain(`38;2;${r};${g};${b}`);
  });

  it("handles MCP count 'initializing' without rendering NaN or 'undefined'", () => {
    const lines = buildSplashLines(baseContext({ mcpReadyCount: "initializing" }));
    const plain = lines.map(strip);
    expect(plain.some((l) => l.includes("initializing"))).toBe(true);
    expect(lines.every((l) => !l.includes("NaN"))).toBe(true);
    expect(lines.every((l) => !l.includes("undefined"))).toBe(true);
  });

  it("includes the cwd and telemetry state on the hint line", () => {
    const lines = buildSplashLines(baseContext({ cwd: "~/foo", telemetry: "on" }));
    const plain = lines.map(strip);
    const hint = plain.find((l) => l.includes("field guide"));
    expect(hint).toBeDefined();
    expect(hint).toContain("~/foo");
    expect(hint).toContain("telemetry on");
  });

  it("ends with a blank trailer so the prompt has breathing room", () => {
    const lines = buildSplashLines(baseContext());
    expect(lines[lines.length - 1]).toBe("");
  });
});

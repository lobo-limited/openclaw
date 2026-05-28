import { describe, it, expect } from "vitest";
import {
  encodeFrame,
  decodeFrame,
  isClientFrame,
  isServerFrame,
  type ClientFrame,
  type ServerFrame,
} from "../../src/lib/gateway/frames";

describe("frames: encode/decode", () => {
  it("round-trips a begin frame", () => {
    const frame: ClientFrame = {
      type: "begin",
      brief: "Refactor auth.go",
      model: "nemotron3-nano:latest",
      repo: "/home/lrjhr/cortejo-api",
    };
    const encoded = encodeFrame(frame);
    expect(typeof encoded).toBe("string");
    const decoded = decodeFrame(encoded);
    expect(decoded).toEqual(frame);
  });

  it("round-trips a begin frame with optional agent id", () => {
    const frame: ClientFrame = {
      type: "begin",
      brief: "Refactor auth.go",
      model: "nemotron3-nano:latest",
      repo: "/home/lrjhr/cortejo-api",
      agent: "hunt",
    };
    const decoded = decodeFrame(encodeFrame(frame));
    expect(decoded).toEqual(frame);
  });

  it("rejects begin frames whose agent is the wrong type", () => {
    expect(() =>
      decodeFrame('{"type":"begin","brief":"b","model":"m","repo":"r","agent":42}'),
    ).toThrow(/begin: agent must be string/i);
  });

  it("round-trips a decision frame", () => {
    const frame: ClientFrame = { type: "decision", action: "approve" };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it("round-trips a session frame", () => {
    const frame: ServerFrame = {
      type: "session",
      id: "plate-185",
      createdAt: "2026-05-27T22:14:00Z",
    };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it("round-trips a delta frame", () => {
    const frame: ServerFrame = { type: "delta", traceId: "t1", text: "hello" };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it("rejects invalid JSON", () => {
    expect(() => decodeFrame("not json")).toThrow(/invalid frame/i);
  });

  it("rejects frames without a recognized type", () => {
    expect(() => decodeFrame('{"type":"nope"}')).toThrow(/unknown frame type/i);
  });

  it("rejects frames missing required fields", () => {
    expect(() => decodeFrame('{"type":"begin"}')).toThrow(/begin: missing brief/i);
  });
});

describe("frames: type guards", () => {
  it("isClientFrame accepts begin/decision/interrupt", () => {
    expect(isClientFrame({ type: "begin", brief: "x", model: "m", repo: "/r" })).toBe(true);
    expect(isClientFrame({ type: "decision", action: "reject" })).toBe(true);
    expect(isClientFrame({ type: "interrupt" })).toBe(true);
  });

  it("isClientFrame rejects server frames", () => {
    expect(isClientFrame({ type: "session", id: "x", createdAt: "" })).toBe(false);
  });

  it("isServerFrame accepts session/trace/delta/complete/decision-required/error/final", () => {
    expect(isServerFrame({ type: "session", id: "x", createdAt: "y" })).toBe(true);
    expect(isServerFrame({ type: "trace", kind: "plan", id: "t1", data: {} })).toBe(true);
    expect(isServerFrame({ type: "delta", traceId: "t1", text: "x" })).toBe(true);
    expect(isServerFrame({ type: "complete", traceId: "t1" })).toBe(true);
    expect(
      isServerFrame({
        type: "decision-required",
        plateId: "p",
        proposal: { files: [], notes: [] },
      }),
    ).toBe(true);
    expect(isServerFrame({ type: "error", code: "X", message: "y" })).toBe(true);
    expect(isServerFrame({ type: "final", outcome: "applied", summary: "s" })).toBe(true);
  });
});

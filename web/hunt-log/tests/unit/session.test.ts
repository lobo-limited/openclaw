import { describe, it, expect } from "vitest";
import { sessionReducer, type SessionState } from "../../src/lib/stores/session";

const empty: SessionState = null;

describe("sessionReducer", () => {
  it("initializes on session frame", () => {
    const next = sessionReducer(empty, {
      type: "session",
      id: "plate-185",
      createdAt: "2026-05-27T22:14:00Z",
    });
    expect(next).toEqual({
      id: "plate-185",
      createdAt: "2026-05-27T22:14:00Z",
      status: "live",
    });
  });

  it("flips status on final", () => {
    const initial: SessionState = { id: "p1", createdAt: "t", status: "live" };
    expect(
      sessionReducer(initial, { type: "final", outcome: "applied", summary: "s" })?.status,
    ).toBe("ended");
    expect(
      sessionReducer(initial, { type: "final", outcome: "rejected", summary: "s" })?.status,
    ).toBe("ended");
    expect(
      sessionReducer(initial, { type: "final", outcome: "timeout", summary: "s" })?.status,
    ).toBe("timeout");
  });

  it("ignores frames before session is initialized", () => {
    expect(sessionReducer(empty, { type: "delta", traceId: "t", text: "x" })).toEqual(empty);
  });
});

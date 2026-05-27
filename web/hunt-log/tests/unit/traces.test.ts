import { describe, it, expect } from "vitest";
import type { ServerFrame } from "../../src/lib/gateway/frames";
import { tracesReducer, type TracesState } from "../../src/lib/stores/traces";

const empty: TracesState = { order: [], byId: {} };

describe("tracesReducer", () => {
  it("inserts a new trace on type=trace", () => {
    const f: ServerFrame = { type: "trace", kind: "plan", id: "t1", data: { steps: [] } };
    const next = tracesReducer(empty, f);
    expect(next.order).toEqual(["t1"]);
    expect(next.byId.t1.kind).toBe("plan");
    expect(next.byId.t1.status).toBe("streaming");
  });

  it("appends delta text to the matching trace", () => {
    const initial: TracesState = {
      order: ["t1"],
      byId: { t1: { id: "t1", kind: "reply", data: { text: "hello " }, status: "streaming" } },
    };
    const next = tracesReducer(initial, { type: "delta", traceId: "t1", text: "world" });
    expect((next.byId.t1.data as { text: string }).text).toBe("hello world");
    expect(next.byId.t1.status).toBe("streaming");
  });

  it("flips status to done on complete", () => {
    const initial: TracesState = {
      order: ["t1"],
      byId: { t1: { id: "t1", kind: "reply", data: { text: "x" }, status: "streaming" } },
    };
    const next = tracesReducer(initial, { type: "complete", traceId: "t1" });
    expect(next.byId.t1.status).toBe("done");
  });

  it("synthesizes an error trace on type=error", () => {
    const next = tracesReducer(empty, { type: "error", code: "BAD_FRAME", message: "boom" });
    expect(next.order).toHaveLength(1);
    const onlyId = next.order[0];
    expect(next.byId[onlyId].kind).toBe("reply");
    expect(next.byId[onlyId].status).toBe("error");
  });

  it("ignores unrelated server frames (session, decision-required, final)", () => {
    expect(tracesReducer(empty, { type: "session", id: "p", createdAt: "" })).toEqual(empty);
    expect(
      tracesReducer(empty, {
        type: "decision-required",
        plateId: "p",
        proposal: { files: [], notes: [] },
      }),
    ).toEqual(empty);
    expect(tracesReducer(empty, { type: "final", outcome: "applied", summary: "s" })).toEqual(
      empty,
    );
  });

  it("ignores delta for unknown trace id", () => {
    const next = tracesReducer(empty, { type: "delta", traceId: "unknown", text: "x" });
    expect(next).toEqual(empty);
  });
});

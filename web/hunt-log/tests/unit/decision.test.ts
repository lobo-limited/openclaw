import { describe, it, expect } from "vitest";
import type { ServerFrame } from "../../src/lib/gateway/frames";
import { decisionReducer, type DecisionState } from "../../src/lib/stores/decision";

const empty: DecisionState = null;

describe("decisionReducer", () => {
  it("captures pending proposal on decision-required", () => {
    const f: ServerFrame = {
      type: "decision-required",
      plateId: "plate-185",
      proposal: { files: [{ name: "auth.go", hunks: "@@ -1 +1 @@" }], notes: ["x"] },
    };
    const next = decisionReducer(empty, f);
    expect(next?.plateId).toBe("plate-185");
    expect(next?.status).toBe("pending");
  });

  it("clears on final", () => {
    const pending: DecisionState = {
      plateId: "p",
      proposal: { files: [], notes: [] },
      status: "pending",
    };
    expect(
      decisionReducer(pending, { type: "final", outcome: "applied", summary: "s" }),
    ).toBeNull();
  });

  it("does nothing on unrelated frames", () => {
    expect(decisionReducer(empty, { type: "delta", traceId: "t", text: "x" })).toEqual(empty);
  });
});

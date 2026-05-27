// Hunt Log decision store: holds the pending decision-required proposal awaiting
// operator action. Cleared on `final` (regardless of outcome — the operator's
// decision is captured upstream; this store only tracks "is there a pending ask?").

import { writable, type Writable } from "svelte/store";
import type { ServerFrame } from "../gateway/frames";

export interface PendingDecision {
  plateId: string;
  proposal: { files: Array<{ name: string; hunks: string }>; notes: string[] };
  status: "pending";
}

export type DecisionState = PendingDecision | null;

export function decisionReducer(state: DecisionState, frame: ServerFrame): DecisionState {
  switch (frame.type) {
    case "decision-required":
      return { plateId: frame.plateId, proposal: frame.proposal, status: "pending" };
    case "final":
      return null;
    default:
      return state;
  }
}

export const decision: Writable<DecisionState> = writable(null);

export function applyToDecision(frame: ServerFrame): void {
  decision.update((s) => decisionReducer(s, frame));
}

export function resetDecision(): void {
  decision.set(null);
}

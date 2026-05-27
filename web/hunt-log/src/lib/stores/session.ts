// Hunt Log session store: tracks the current plate session lifecycle.
// `live` once the BFF emits a session frame; `ended`/`timeout` on final.

import { writable, type Writable } from "svelte/store";
import type { ServerFrame } from "../gateway/frames";

export type SessionStatus = "live" | "ended" | "timeout";

export interface Session {
  id: string;
  createdAt: string;
  status: SessionStatus;
}

export type SessionState = Session | null;

export function sessionReducer(state: SessionState, frame: ServerFrame): SessionState {
  switch (frame.type) {
    case "session":
      return { id: frame.id, createdAt: frame.createdAt, status: "live" };
    case "final": {
      if (!state) return state;
      return { ...state, status: frame.outcome === "timeout" ? "timeout" : "ended" };
    }
    default:
      return state;
  }
}

export const session: Writable<SessionState> = writable(null);

export function applyToSession(frame: ServerFrame): void {
  session.update((s) => sessionReducer(s, frame));
}

export function resetSession(): void {
  session.set(null);
}

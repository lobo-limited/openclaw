// Hunt Log traces store: append-only ordered list of agent traces (plan/specimen/reply).
// Pure reducer + thin svelte/store writable wrapper. The reducer projects ServerFrames
// into TracesState; the writable lets components subscribe to changes.

import { writable, type Writable } from "svelte/store";
import type { ServerFrame, TraceKind } from "../gateway/frames";

export type TraceStatus = "streaming" | "done" | "error";

export interface Trace {
  id: string;
  kind: TraceKind;
  data: Record<string, unknown>;
  status: TraceStatus;
}

export interface TracesState {
  order: string[];
  byId: Record<string, Trace>;
}

const EMPTY: TracesState = { order: [], byId: {} };

export function tracesReducer(state: TracesState, frame: ServerFrame): TracesState {
  switch (frame.type) {
    case "trace": {
      if (state.byId[frame.id]) return state;
      const trace: Trace = {
        id: frame.id,
        kind: frame.kind,
        data: { ...frame.data },
        status: "streaming",
      };
      return {
        order: [...state.order, frame.id],
        byId: { ...state.byId, [frame.id]: trace },
      };
    }
    case "delta": {
      const existing = state.byId[frame.traceId];
      if (!existing) return state;
      const prevText = typeof existing.data.text === "string" ? existing.data.text : "";
      const updated: Trace = {
        ...existing,
        data: { ...existing.data, text: prevText + frame.text },
      };
      return { order: state.order, byId: { ...state.byId, [frame.traceId]: updated } };
    }
    case "complete": {
      const existing = state.byId[frame.traceId];
      if (!existing) return state;
      return {
        order: state.order,
        byId: { ...state.byId, [frame.traceId]: { ...existing, status: "done" } },
      };
    }
    case "error": {
      const id = `error-${state.order.length + 1}`;
      const trace: Trace = {
        id,
        kind: "reply",
        data: { text: `${frame.code}: ${frame.message}` },
        status: "error",
      };
      return { order: [...state.order, id], byId: { ...state.byId, [id]: trace } };
    }
    default:
      return state;
  }
}

export const traces: Writable<TracesState> = writable({ ...EMPTY });

export function applyToTraces(frame: ServerFrame): void {
  traces.update((s) => tracesReducer(s, frame));
}

export function resetTraces(): void {
  traces.set({ order: [], byId: {} });
}

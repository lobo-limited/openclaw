// Browser <-> BFF frame protocol for the Hunt Log session WebSocket.
// Gateway-agnostic: the BFF projects Gateway events into ServerFrames and
// vice versa. See docs/gateway-frames.md for Gateway-side shapes.

export type ClientFrame =
  | { type: "begin"; brief: string; model: string; repo: string; agent?: string }
  | { type: "decision"; action: "approve" | "edit" | "reject"; edits?: string }
  | { type: "interrupt" };

export type TraceKind = "plan" | "specimen" | "reply";

export type ServerFrame =
  | { type: "session"; id: string; createdAt: string }
  | { type: "trace"; kind: TraceKind; id: string; data: Record<string, unknown> }
  | { type: "delta"; traceId: string; text: string }
  | { type: "complete"; traceId: string }
  | {
      type: "decision-required";
      plateId: string;
      proposal: { files: Array<{ name: string; hunks: string }>; notes: string[] };
    }
  | { type: "error"; code: string; message: string }
  | { type: "final"; outcome: "applied" | "rejected" | "timeout"; summary: string };

export type Frame = ClientFrame | ServerFrame;

export function encodeFrame(frame: Frame): string {
  return JSON.stringify(frame);
}

export function decodeFrame(raw: string): Frame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid frame: not JSON (${(e as Error).message})`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error("invalid frame: not an object");
  const obj = parsed as Record<string, unknown>;
  const t = obj.type;
  if (typeof t !== "string") throw new Error("invalid frame: missing type");

  switch (t) {
    case "begin":
      if (typeof obj.brief !== "string") throw new Error("begin: missing brief");
      if (typeof obj.model !== "string") throw new Error("begin: missing model");
      if (typeof obj.repo !== "string") throw new Error("begin: missing repo");
      if (obj.agent !== undefined && typeof obj.agent !== "string")
        throw new Error("begin: agent must be string when present");
      return {
        type: "begin",
        brief: obj.brief,
        model: obj.model,
        repo: obj.repo,
        ...(typeof obj.agent === "string" ? { agent: obj.agent } : {}),
      };
    case "decision":
      if (obj.action !== "approve" && obj.action !== "edit" && obj.action !== "reject")
        throw new Error("decision: invalid action");
      return {
        type: "decision",
        action: obj.action,
        ...(typeof obj.edits === "string" ? { edits: obj.edits } : {}),
      };
    case "interrupt":
      return { type: "interrupt" };
    case "session":
      if (typeof obj.id !== "string") throw new Error("session: missing id");
      if (typeof obj.createdAt !== "string") throw new Error("session: missing createdAt");
      return { type: "session", id: obj.id, createdAt: obj.createdAt };
    case "trace":
      if (obj.kind !== "plan" && obj.kind !== "specimen" && obj.kind !== "reply")
        throw new Error("trace: invalid kind");
      if (typeof obj.id !== "string") throw new Error("trace: missing id");
      if (!obj.data || typeof obj.data !== "object") throw new Error("trace: missing data");
      return {
        type: "trace",
        kind: obj.kind,
        id: obj.id,
        data: obj.data as Record<string, unknown>,
      };
    case "delta":
      if (typeof obj.traceId !== "string") throw new Error("delta: missing traceId");
      if (typeof obj.text !== "string") throw new Error("delta: missing text");
      return { type: "delta", traceId: obj.traceId, text: obj.text };
    case "complete":
      if (typeof obj.traceId !== "string") throw new Error("complete: missing traceId");
      return { type: "complete", traceId: obj.traceId };
    case "decision-required":
      if (typeof obj.plateId !== "string") throw new Error("decision-required: missing plateId");
      if (!obj.proposal || typeof obj.proposal !== "object")
        throw new Error("decision-required: missing proposal");
      return {
        type: "decision-required",
        plateId: obj.plateId,
        proposal: obj.proposal as {
          files: Array<{ name: string; hunks: string }>;
          notes: string[];
        },
      };
    case "error":
      if (typeof obj.code !== "string") throw new Error("error: missing code");
      if (typeof obj.message !== "string") throw new Error("error: missing message");
      return { type: "error", code: obj.code, message: obj.message };
    case "final":
      if (obj.outcome !== "applied" && obj.outcome !== "rejected" && obj.outcome !== "timeout")
        throw new Error("final: invalid outcome");
      if (typeof obj.summary !== "string") throw new Error("final: missing summary");
      return { type: "final", outcome: obj.outcome, summary: obj.summary };
    default:
      throw new Error(`unknown frame type: ${t}`);
  }
}

const CLIENT_TYPES = new Set(["begin", "decision", "interrupt"]);
const SERVER_TYPES = new Set([
  "session",
  "trace",
  "delta",
  "complete",
  "decision-required",
  "error",
  "final",
]);

export function isClientFrame(frame: unknown): frame is ClientFrame {
  return (
    !!frame &&
    typeof frame === "object" &&
    CLIENT_TYPES.has((frame as { type?: string }).type ?? "")
  );
}

export function isServerFrame(frame: unknown): frame is ServerFrame {
  return (
    !!frame &&
    typeof frame === "object" &&
    SERVER_TYPES.has((frame as { type?: string }).type ?? "")
  );
}

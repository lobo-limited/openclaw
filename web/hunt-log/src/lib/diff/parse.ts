export type DiffLineKind = "add" | "remove" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

const HUNK_HEADER = /^@@/;

export function parseUnifiedDiff(raw: string): DiffHunk[] {
  if (!raw.trim()) return [];
  const lines = raw.split("\n");
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;

  for (const line of lines) {
    if (HUNK_HEADER.test(line)) {
      if (current) hunks.push(current);
      current = { header: line, lines: [] };
      continue;
    }
    if (!current) {
      current = { header: "", lines: [] };
    }
    if (line.startsWith("+")) current.lines.push({ kind: "add", text: line.slice(1) });
    else if (line.startsWith("-")) current.lines.push({ kind: "remove", text: line.slice(1) });
    else current.lines.push({ kind: "context", text: line.startsWith(" ") ? line.slice(1) : line });
  }
  if (current) hunks.push(current);
  return hunks;
}

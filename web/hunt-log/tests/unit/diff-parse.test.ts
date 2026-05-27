import { describe, it, expect } from "vitest";
import { parseUnifiedDiff, type DiffLine } from "../../src/lib/diff/parse";

const sample = `@@ -28,7 +28,9 @@ func New(cfg Config) *AuthMiddleware {
 func New(cfg Config) *AuthMiddleware {
     return &AuthMiddleware{
         cfg: cfg,
+        log: cfg.Logger.Named("middleware.auth"),
     }
 }`;

describe("parseUnifiedDiff", () => {
  it("parses hunks and classifies lines", () => {
    const hunks = parseUnifiedDiff(sample);
    expect(hunks).toHaveLength(1);
    const lines = hunks[0].lines;
    expect(lines.find((l: DiffLine) => l.kind === "add")?.text).toContain("log: cfg.Logger.Named");
    expect(lines.filter((l: DiffLine) => l.kind === "context").length).toBeGreaterThan(0);
    expect(hunks[0].header).toContain("func New");
  });

  it("tolerates input without a hunk header (treats as one synthetic hunk)", () => {
    const hunks = parseUnifiedDiff("+added\n-removed\n context");
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines.map((l) => l.kind)).toEqual(["add", "remove", "context"]);
  });

  it("handles empty input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});

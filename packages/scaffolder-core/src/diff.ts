// Trivial unified-diff producer for plan() output.
import type { UnifiedDiff } from "./types";

export function makeUnifiedDiff(
  before: string | null,
  after: string | null,
  path: string,
): UnifiedDiff {
  const beforeLines = before == null ? [] : before.split("\n");
  const afterLines = after == null ? [] : after.split("\n");
  const header =
    `--- ${before == null ? "/dev/null" : `a/${path}`}\n` +
    `+++ ${after == null ? "/dev/null" : `b/${path}`}\n`;
  const removed = beforeLines.map((l) => `-${l}`);
  const added = afterLines.map((l) => `+${l}`);
  return {
    before,
    after,
    patch: header + [...removed, ...added].join("\n"),
  };
}

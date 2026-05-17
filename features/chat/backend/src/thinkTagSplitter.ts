// Streaming parser that splits a model's token stream into "reasoning" and
// "content" channels by detecting `<think>...</think>` markers, which is the
// convention used by Qwen3, DeepSeek-R1, and a few other open-weight models
// that expose chain-of-thought.
//
// Designed to be:
//   - Streaming: chunks may split a marker across boundaries; the splitter
//     buffers up to MAX_LOOKAHEAD chars so we never miss a tag.
//   - Multi-block: a single turn may contain several `<think>` blocks; durations
//     accumulate across all of them.
//   - Pass-through safe: if no `<think>` tag ever appears, every chunk reports
//     all input as content and no reasoning timing is recorded.
//
// The splitter is stateful — instantiate one per assistant turn, push chunks
// in order, then read `reasoning` / `content` / `totalReasoningMs` once the
// upstream stream finishes.

const OPEN = "<think>";
const CLOSE = "</think>";

export interface SplitChunk {
  /** Reasoning characters produced from this push (empty if none). */
  reasoning: string;
  /** Content characters produced from this push (empty if none). */
  content: string;
  /** True if this push completed a `</think>` (i.e. exited reasoning mode). */
  reasoningEnded: boolean;
}

export class ThinkTagSplitter {
  private mode: "content" | "reasoning" = "content";
  /** Buffer of trailing characters that might start a tag. Flushed appropriately on the next push. */
  private buffer = "";
  /** Fully classified reasoning text accumulated across the whole stream. */
  private reasoningBuf = "";
  /** Fully classified content text accumulated across the whole stream. */
  private contentBuf = "";
  /** Timestamp when the current `<think>` block started, or null. */
  private currentBlockStart: number | null = null;
  /** Total ms spent in completed `<think>` blocks. */
  private completedMs = 0;

  push(chunk: string): SplitChunk {
    if (!chunk) return { reasoning: "", content: "", reasoningEnded: false };
    let work = this.buffer + chunk;
    this.buffer = "";
    let reasoningOut = "";
    let contentOut = "";
    let reasoningEnded = false;

    while (work.length > 0) {
      if (this.mode === "content") {
        const openIdx = work.indexOf(OPEN);
        if (openIdx === -1) {
          // No complete tag here. Emit everything except the suffix that could
          // still grow into a `<think>` marker.
          const flushable = trimAmbiguousSuffix(work, OPEN);
          if (flushable.length > 0) {
            contentOut += flushable;
            this.contentBuf += flushable;
          }
          this.buffer = work.slice(flushable.length);
          work = "";
        } else {
          // Emit everything before the tag as content, then enter reasoning mode.
          const beforeTag = work.slice(0, openIdx);
          if (beforeTag.length > 0) {
            contentOut += beforeTag;
            this.contentBuf += beforeTag;
          }
          work = work.slice(openIdx + OPEN.length);
          this.mode = "reasoning";
          this.currentBlockStart = Date.now();
        }
      } else {
        const closeIdx = work.indexOf(CLOSE);
        if (closeIdx === -1) {
          const flushable = trimAmbiguousSuffix(work, CLOSE);
          if (flushable.length > 0) {
            reasoningOut += flushable;
            this.reasoningBuf += flushable;
          }
          this.buffer = work.slice(flushable.length);
          work = "";
        } else {
          const beforeTag = work.slice(0, closeIdx);
          if (beforeTag.length > 0) {
            reasoningOut += beforeTag;
            this.reasoningBuf += beforeTag;
          }
          work = work.slice(closeIdx + CLOSE.length);
          this.mode = "content";
          if (this.currentBlockStart != null) {
            this.completedMs += Date.now() - this.currentBlockStart;
            this.currentBlockStart = null;
          }
          reasoningEnded = true;
        }
      }
    }

    return { reasoning: reasoningOut, content: contentOut, reasoningEnded };
  }

  /** Flush any buffered tail as the appropriate channel. Call after the upstream stream ends. */
  finalize(): SplitChunk {
    let reasoningOut = "";
    let contentOut = "";
    if (this.buffer.length > 0) {
      if (this.mode === "reasoning") {
        reasoningOut = this.buffer;
        this.reasoningBuf += this.buffer;
      } else {
        contentOut = this.buffer;
        this.contentBuf += this.buffer;
      }
      this.buffer = "";
    }
    let reasoningEnded = false;
    // If the stream ended mid-`<think>` (no closing tag), close out the timer
    // so durationMs still reflects the time spent thinking.
    if (this.mode === "reasoning" && this.currentBlockStart != null) {
      this.completedMs += Date.now() - this.currentBlockStart;
      this.currentBlockStart = null;
      this.mode = "content";
      reasoningEnded = true;
    }
    return { reasoning: reasoningOut, content: contentOut, reasoningEnded };
  }

  get reasoning(): string {
    return this.reasoningBuf;
  }

  get content(): string {
    return this.contentBuf;
  }

  get totalReasoningMs(): number {
    return this.completedMs;
  }
}

// Return the longest prefix of `s` such that the remaining suffix could NOT be
// the start of `tag`. e.g. for tag="<think>" and s="hi <thi" → "hi " (kept back
// "<thi" because it could grow into "<think>").
function trimAmbiguousSuffix(s: string, tag: string): string {
  const max = Math.min(tag.length - 1, s.length);
  for (let n = max; n > 0; n--) {
    if (tag.startsWith(s.slice(s.length - n))) {
      return s.slice(0, s.length - n);
    }
  }
  return s;
}

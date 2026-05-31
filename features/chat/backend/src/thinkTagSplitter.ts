// Streaming parser splitting a model token stream into reasoning/content channels via `<think>` markers.
// Stateful: instantiate one per assistant turn, push chunks in order, then read the accumulated getters.

const OPEN = "<think>";
const CLOSE = "</think>";

export interface SplitChunk {
  reasoning: string;
  content: string;
  // True if this push completed a `</think>` (exited reasoning mode).
  reasoningEnded: boolean;
}

export class ThinkTagSplitter {
  private mode: "content" | "reasoning" = "content";
  // Buffer of trailing chars that might start a tag, flushed on the next push.
  private buffer = "";
  private reasoningBuf = "";
  private contentBuf = "";
  private currentBlockStart: number | null = null;
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
          // Hold back any suffix that could still grow into a `<think>` marker.
          const flushable = trimAmbiguousSuffix(work, OPEN);
          if (flushable.length > 0) {
            contentOut += flushable;
            this.contentBuf += flushable;
          }
          this.buffer = work.slice(flushable.length);
          work = "";
        } else {
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

  // Flush any buffered tail. Call after the upstream stream ends.
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
    // Stream ended mid-`<think>`, close the timer so duration still counts.
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

// Longest prefix of `s` whose remaining suffix cannot be the start of `tag` (holds back partial markers).
function trimAmbiguousSuffix(s: string, tag: string): string {
  const max = Math.min(tag.length - 1, s.length);
  for (let n = max; n > 0; n--) {
    if (tag.startsWith(s.slice(s.length - n))) {
      return s.slice(0, s.length - n);
    }
  }
  return s;
}

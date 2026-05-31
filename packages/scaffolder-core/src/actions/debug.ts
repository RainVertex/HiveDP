// Trivial echo action used for plan-shape tests, dry-run smoke tests, and as a default fallback.

import { z } from "zod";
import type { Action, WriteCtx } from "./types";

const debugInput = z.object({ message: z.string() });

export const debugLogAction: Action<z.infer<typeof debugInput>, { message: string }> = {
  id: "debug:log",
  description: "Echoes a message to the task log.",
  schema: debugInput,
  capabilities: [],
  async match() {
    return "absent";
  },
  async diff(input) {
    return [{ kind: "debug.log", message: input.message }];
  },
  async apply(input, ctx: WriteCtx) {
    ctx.logger.info(input.message);
    return { output: { message: input.message } };
  },
};

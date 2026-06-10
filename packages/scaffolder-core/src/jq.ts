// Thin wrapper around jq-wasm so the jq engine stays swappable.
import * as jq from "jq-wasm";

export class JqEvalError extends Error {
  constructor(
    public readonly filter: string,
    cause: string,
  ) {
    super(`jq filter failed: ${filter}: ${cause}`);
    this.name = "JqEvalError";
  }
}

export async function evalJq(input: unknown, filter: string): Promise<unknown> {
  try {
    // Stringified so null and other primitives stay valid jq inputs.
    return await jq.json(JSON.stringify(input ?? null), filter);
  } catch (err) {
    throw new JqEvalError(filter, err instanceof Error ? err.message : String(err));
  }
}

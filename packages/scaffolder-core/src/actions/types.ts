import type { ZodType } from "zod";
import type { Capability, MatchResult, Mutation } from "../types";
import type { PlanCtx } from "../plan-ctx";

// Core action interface and context/compensation types shared across scaffolder actions.

// Read context passed to action.match() and action.diff() during plan().
export type ReadCtx = PlanCtx;

export interface ActionLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface SecretAccessor {
  read(name: string): string;
  // Returns the secret value or null without throwing.
  tryRead(name: string): string | null;
  // Lists registered secret names (not values).
  names(): string[];
}

// Inverse operation recorded after a successful apply step.
export type Compensation =
  | {
      kind: "fs.restore";
      path: string;
      previousContent: string | null; // null means "delete the file we created"
      previousMode?: number;
    }
  | { kind: "fs.unrename"; from: string; to: string }
  | {
      // previousContent === null deletes the file (it did not exist before).
      kind: "repo.restore";
      files: Array<{ path: string; previousContent: string | null }>;
    }
  | { kind: "db.delete"; model: string; where: Record<string, unknown> }
  | {
      kind: "db.restore";
      model: string;
      where: Record<string, unknown>;
      previousData: Record<string, unknown>;
    }
  | { kind: "noop"; reason: string };

// Write context passed to action.apply().
export interface WriteCtx extends PlanCtx {
  workspacePath: string;
  // Isolated repo staging dir inside the workspace.
  repoRoot: string;
  logger: ActionLogger;
  signal: AbortSignal;
  secrets: SecretAccessor;
  dryRun: boolean;
}

export interface ActionResult<O> {
  output: O;
  compensation?: Compensation;
}

export interface Action<I = unknown, O = unknown> {
  id: string;
  description: string;
  schema: ZodType<I>;
  capabilities: Capability[];
  irreversible?: boolean;
  // Reports whether the target already exists in a state matching this step.
  match(input: I, ctx: ReadCtx): Promise<MatchResult>;
  diff(input: I, ctx: ReadCtx): Promise<Mutation[]>;
  apply(input: I, ctx: WriteCtx): Promise<ActionResult<O>>;
}

// Type-erased Action used by the registry and executor (generic variance otherwise blocks storage).
export type AnyAction = Action<unknown, unknown>;

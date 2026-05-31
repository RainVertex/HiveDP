// Narrow read-only surface passed to a template's plan() function.
import type { Actor, Binding, SandboxTarget, TeamSummary, UserSummary } from "./types";

export interface PlanCtx {
  actor: Actor;
  target: SandboxTarget;

  // Frozen wall-clock, same value for the lifetime of the plan call.
  now(): Date;

  existsInRepo(path: string): Promise<boolean>;
  readRepoFile(path: string): Promise<string | null>;

  readBinding(targetRef: string): Promise<Binding | null>;
  currentTeam(id: string): Promise<TeamSummary | null>;
  currentUser(id: string): Promise<UserSummary | null>;

  toTitle(s: string): string;
  toCamel(s: string): string;
  toPascal(s: string): string;
  toKebab(s: string): string;
}

export const stringHelpers = {
  toKebab(s: string): string {
    return s
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/[\s_]+/g, "-")
      .toLowerCase();
  },
  toPascal(s: string): string {
    return stringHelpers
      .toKebab(s)
      .split("-")
      .filter(Boolean)
      .map((w) => w[0]!.toUpperCase() + w.slice(1))
      .join("");
  },
  toCamel(s: string): string {
    const pascal = stringHelpers.toPascal(s);
    return pascal ? pascal[0]!.toLowerCase() + pascal.slice(1) : "";
  },
  toTitle(s: string): string {
    return stringHelpers
      .toKebab(s)
      .split("-")
      .filter(Boolean)
      .map((w) => w[0]!.toUpperCase() + w.slice(1))
      .join(" ");
  },
};

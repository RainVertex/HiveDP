// Org-level visibility for catalog entities: existence is public, details require
// membership in the entity's GitHub org (entity.accountLogin vs UserOrgMembership).
import type { RequestHandler } from "express";
import { prisma, type User } from "@internal/db";

export type OrgActor = Pick<User, "id" | "role" | "userKind">;

/** Entity fields safe to expose to non-members, loaded once by the middleware. */
export interface EntityOrgRef {
  id: string;
  accountLogin: string;
  name: string;
  kind: string;
  lifecycle: string;
  description: string | null;
}

// null means unrestricted. Agents never sign in, so their scope derives from their teams' orgs.
export async function getVisibleOrgLogins(user: OrgActor): Promise<string[] | null> {
  if (user.role === "admin") return null;
  if (user.userKind === "agent") {
    const teams = await prisma.team.findMany({
      where: { deletedAt: null, memberships: { some: { userId: user.id } } },
      select: { accountLogin: true },
      distinct: ["accountLogin"],
    });
    return teams.map((t) => t.accountLogin);
  }
  const memberships = await prisma.userOrgMembership.findMany({
    where: { userId: user.id },
    select: { accountLogin: true },
  });
  return memberships.map((m) => m.accountLogin);
}

// Scope for ToolContext callers. A null userId is a trusted system run (cron), so unrestricted.
export async function resolveOrgScope(
  userId: string | null,
  isAdmin: boolean,
): Promise<string[] | null> {
  if (isAdmin || userId === null) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, userKind: true },
  });
  if (!user) return [];
  return getVisibleOrgLogins(user);
}

export function isOrgVisible(scope: string[] | null, accountLogin: string): boolean {
  return scope === null || scope.includes(accountLogin);
}

export async function canViewEntityDetails(user: OrgActor, accountLogin: string): Promise<boolean> {
  return isOrgVisible(await getVisibleOrgLogins(user), accountLogin);
}

/** Prisma where fragment limiting entities to the visible orgs, {} when unrestricted. */
export function visibleEntityWhere(scope: string[] | null): { accountLogin?: { in: string[] } } {
  return scope === null ? {} : { accountLogin: { in: scope } };
}

/** Loads the entity once, 404s unknown ids, 403s non-members, stashes the row on res.locals.entityRef. */
// Typed over a string param dictionary so route level param inference stays intact.
export function requireEntityOrgAccess(param = "id"): RequestHandler<Record<string, string>> {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    const entityId = req.params[param];
    const entity = await prisma.catalogEntity.findUnique({
      where: { id: entityId },
      select: {
        id: true,
        accountLogin: true,
        name: true,
        kind: true,
        lifecycle: true,
        description: true,
      },
    });
    if (!entity) return res.status(404).json({ error: "Catalog entity not found" });
    if (!(await canViewEntityDetails(req.user, entity.accountLogin))) {
      return res.status(403).json({ error: "Org membership required" });
    }
    res.locals.entityRef = entity satisfies EntityOrgRef;
    next();
  };
}

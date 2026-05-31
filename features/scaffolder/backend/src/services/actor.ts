// Resolves a scaffolder Actor from req.user plus the user's team memberships.
import type { Request } from "express";
import { prisma } from "@internal/db";
import type { Actor } from "@internal/scaffolder-core";

export async function actorFromRequest(req: Request): Promise<Actor | null> {
  const user = req.user;
  if (!user) return null;
  const memberships = await prisma.teamMembership.findMany({
    where: { userId: user.id, team: { deletedAt: null } },
    select: { teamId: true },
  });
  return {
    kind: "human",
    userId: user.id,
    teamIds: memberships.map((m) => m.teamId),
  };
}

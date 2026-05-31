// Per-entity authorization for observability reads (logs, traces, dashboards can leak data).
// Requires membership in one of the entity's owning teams (admins bypass) rather than just auth.
import { prisma } from "@internal/db";

export interface ObservabilityActor {
  id: string;
  role: string;
}

export async function canReadEntityObservability(
  user: ObservabilityActor,
  entityId: string,
): Promise<boolean> {
  if (user.role === "admin") return true;
  const count = await prisma.catalogEntityOwner.count({
    where: {
      entityId,
      team: { memberships: { some: { userId: user.id } } },
    },
  });
  return count > 0;
}

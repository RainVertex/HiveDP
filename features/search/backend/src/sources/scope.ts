import { prisma } from "@internal/db";

// Project ids the user is a member of; projects and tasks are scoped by these.
export async function memberProjectIds(userId: string): Promise<string[]> {
  const rows = await prisma.projectMember.findMany({
    where: { userId },
    select: { projectId: true },
  });
  return rows.map((m) => m.projectId);
}

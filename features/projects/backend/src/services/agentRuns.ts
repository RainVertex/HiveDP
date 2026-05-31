import { prisma } from "@internal/db";
import { runAgent } from "@feature/agents-backend";
import { notifyTaskCommented } from "./notifications";

// When an agent is assigned to a task it works on it under its own identity (its backing User), then posts the result back as a task comment. Fire-and-forget so the assignment request returns immediately.

export function triggerAgentRunForTask(args: { agentUserId: string; taskId: string }): void {
  void runAgentForTask(args).catch((err) => {
    console.error(`Agent task run failed (task ${args.taskId}):`, err);
  });
}

async function runAgentForTask({
  agentUserId,
  taskId,
}: {
  agentUserId: string;
  taskId: string;
}): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { userId: agentUserId },
    select: { id: true },
  });
  if (!agent) return;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { id: true, title: true, creatorUserId: true } },
      assignees: { select: { userId: true } },
    },
  });
  if (!task) return;

  const memberships = await prisma.teamMembership.findMany({
    where: { userId: agentUserId, team: { deletedAt: null } },
    select: { teamId: true },
  });

  const result = await runAgent(
    agent.id,
    {
      task: { id: task.id, title: task.title, description: task.description },
      project: { id: task.project.id, title: task.project.title },
    },
    {
      callerUserId: agentUserId,
      callerIsAdmin: false,
      callerTeamIds: memberships.map((m) => m.teamId),
    },
  );

  const body = result.finalText?.trim();
  if (!body) return;

  const created = await prisma.taskComment.create({
    data: { taskId: task.id, authorUserId: agentUserId, body },
    include: { author: true },
  });

  const recipientIds = new Set<string>([
    ...(task.project.creatorUserId ? [task.project.creatorUserId] : []),
    ...task.assignees.map((a) => a.userId),
  ]);
  await notifyTaskCommented({
    taskId: task.id,
    taskTitle: task.title,
    projectId: task.project.id,
    projectTitle: task.project.title,
    authorUserId: agentUserId,
    authorName: created.author?.displayName ?? "",
    bodySnippet: body.slice(0, 200),
    recipientUserIds: Array.from(recipientIds),
  });
}

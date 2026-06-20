// eslint-disable-next-line no-restricted-imports -- agent model is not in projectsDb, so the agent reads below need the raw prisma singleton.
import { prisma, projectsDb } from "@internal/db";
import {
  enqueueAgentTask,
  registerAgentTaskHandler,
  type AgentTaskHandler,
} from "@feature/agents-backend/contract";
import { notifyTaskCommented } from "./notifications";

// When an agent is assigned to a task it works on it under its own identity (its backing User), then
// posts the result back as a task comment. Assignment enqueues a durable AgentTask, the queue runs it.

const TASK_KIND = "project-task";

export function triggerAgentRunForTask(args: { agentUserId: string; taskId: string }): void {
  void enqueueProjectTask(args).catch((err) => {
    console.error(`Agent task enqueue failed (task ${args.taskId}):`, err);
  });
}

async function enqueueProjectTask({
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

  const task = await projectsDb.task.findUnique({
    where: { id: taskId },
    select: { project: { select: { id: true, creatorUserId: true } } },
  });
  if (!task) return;

  // Grant the agent's backing user WRITE before the run so its task tools pass the permission check.
  // Create-only, so a manually set role is left alone. Done at assignment time, not run time.
  await projectsDb.projectMember.upsert({
    where: { projectId_userId: { projectId: task.project.id, userId: agentUserId } },
    update: {},
    create: {
      projectId: task.project.id,
      userId: agentUserId,
      role: "WRITE",
      addedByUserId: task.project.creatorUserId,
    },
  });

  await enqueueAgentTask({
    agentId: agent.id,
    kind: TASK_KIND,
    payload: { taskId, agentUserId },
    dedupeKey: `${TASK_KIND}:${taskId}:${agentUserId}`,
  });
}

const projectTaskHandler: AgentTaskHandler = {
  async buildRunInput(payload) {
    const taskId = String(payload.taskId);
    const task = await projectsDb.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        description: true,
        project: { select: { id: true, title: true } },
      },
    });
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return {
      task: { id: task.id, title: task.title, description: task.description },
      project: { id: task.project.id, title: task.project.title },
    };
  },

  async runOptions(payload) {
    const agentUserId = String(payload.agentUserId);
    const memberships = await projectsDb.teamMembership.findMany({
      where: { userId: agentUserId, team: { deletedAt: null } },
      select: { teamId: true },
    });
    return {
      callerUserId: agentUserId,
      callerIsAdmin: false,
      callerTeamIds: memberships.map((m) => m.teamId),
      taskId: String(payload.taskId),
    };
  },

  async interpret({ payload, result }) {
    const body = result.finalText?.trim();
    if (!body) return { status: "done" };

    const agentUserId = String(payload.agentUserId);
    const taskId = String(payload.taskId);
    const task = await projectsDb.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        project: { select: { id: true, title: true, creatorUserId: true } },
        assignees: { select: { userId: true } },
      },
    });
    if (!task) return { status: "done" };

    const created = await projectsDb.taskComment.create({
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
    return { status: "done" };
  },
};

export function registerProjectAgentTaskHandlers(): void {
  registerAgentTaskHandler(TASK_KIND, projectTaskHandler);
}

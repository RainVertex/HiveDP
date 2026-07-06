// eslint-disable-next-line no-restricted-imports -- agent model is not in projectsDb, so the agent reads below need the raw prisma singleton.
import { prisma, projectsDb } from "@internal/db";
import {
  enqueueAgentTask,
  isAgentProviderReady,
  registerAgentTaskHandler,
  type AgentTaskHandler,
} from "@feature/agents-backend/contract";
import { notifyTaskCommented, notifyCodingCompleted } from "./notifications";

// When an agent is assigned to a task it works on it under its own identity (its backing User), then
// posts the result back as a task comment. Assignment enqueues a durable AgentTask, the queue runs it.
// A coding agent (runtime="code") instead opens a draft PR and the same comment carries its link. The
// standalone "project-coding-adhoc" kind runs a coding agent on a free-text instruction with no task.

const TASK_KIND = "project-task";
const CODING_ADHOC_KIND = "project-coding-adhoc";

function codingInstruction(title: string, description: string | null): string {
  return description && description.trim() ? `${title}\n\n${description}` : title;
}

// Sibling subtasks share the parent-scoped branch so their commits accumulate into one draft PR.
function codingBranchName(agentName: string, scopeTaskId: string): string {
  const slug =
    agentName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "agent";
  return `agent/${slug}/task-${scopeTaskId}`;
}

// A failed run whose error looks transient (rate limit, timeout, upstream 5xx) is worth retrying via
// the queue's backoff rather than posting the raw error as a task comment and giving up.
function isTransientRunError(result: { status: string; error: string | null }): boolean {
  if (result.status !== "failed" || !result.error) return false;
  return /rate.?limit|429|tokens per min|requests per min|overloaded|temporarily|try again|timeout|ETIMEDOUT|ECONNRESET|502|503|504/i.test(
    result.error,
  );
}

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
  // Defer (rather than burn attempts) until the agent's model provider has a usable key.
  async precheck(payload) {
    const agent = await prisma.agent.findUnique({
      where: { userId: String(payload.agentUserId) },
      select: { id: true },
    });
    if (!agent) return { ready: false, reason: "agent not found" };
    return isAgentProviderReady(agent.id);
  },

  async buildRunInput(payload) {
    const taskId = String(payload.taskId);
    const agentUserId = String(payload.agentUserId);
    const task = await projectsDb.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        description: true,
        parentTaskId: true,
        parent: { select: { title: true } },
        project: {
          select: {
            id: true,
            title: true,
            installationId: true,
            catalogEntity: { select: { repoUrl: true } },
          },
        },
      },
    });
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const agent = await prisma.agent.findUnique({
      where: { userId: agentUserId },
      select: { runtime: true, name: true },
    });
    if (agent?.runtime === "code") {
      // A coding agent gets the work as an instruction plus the resolved repo coordinates. The git
      // token is minted at run time inside runCodingAgent, never stored in this (persisted) input.
      return {
        instruction: codingInstruction(task.title, task.description),
        repo: {
          repoUrl: task.project.catalogEntity?.repoUrl ?? null,
          installationId: task.project.installationId,
        },
        branch: codingBranchName(agent.name, task.parentTaskId ?? task.id),
        // The PR represents the whole parent task, so a subtask run titles it after the parent.
        task: { id: task.id, title: task.parent?.title ?? task.title },
        project: { id: task.project.id, title: task.project.title },
      };
    }

    return {
      task: { id: task.id, title: task.title, description: task.description },
      project: {
        id: task.project.id,
        title: task.project.title,
        repoConnected: Boolean(task.project.catalogEntity?.repoUrl && task.project.installationId),
      },
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
    if (isTransientRunError(result)) return { status: "retry", lastError: result.error };

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

// Standalone coding run: a user triggers a coding agent on a project with a free-text instruction, no
// task. Grants the agent WRITE (so it can read the repo), then enqueues the adhoc kind.
export async function enqueueCodingRun(args: {
  agentUserId: string;
  projectId: string;
  instruction: string;
  branch?: string;
  initiatorUserId: string;
}): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { userId: args.agentUserId },
    select: { id: true },
  });
  if (!agent) throw new Error("Agent not found");
  const project = await projectsDb.project.findUnique({
    where: { id: args.projectId },
    select: { id: true, title: true, creatorUserId: true },
  });
  if (!project) throw new Error("Project not found");

  await projectsDb.projectMember.upsert({
    where: { projectId_userId: { projectId: project.id, userId: args.agentUserId } },
    update: {},
    create: {
      projectId: project.id,
      userId: args.agentUserId,
      role: "WRITE",
      addedByUserId: project.creatorUserId ?? args.initiatorUserId,
    },
  });

  await enqueueAgentTask({
    agentId: agent.id,
    kind: CODING_ADHOC_KIND,
    payload: {
      projectId: project.id,
      projectTitle: project.title,
      agentUserId: args.agentUserId,
      instruction: args.instruction,
      branch: args.branch ?? null,
      initiatorUserId: args.initiatorUserId,
    },
  });
}

const codingAdhocHandler: AgentTaskHandler = {
  async precheck(payload) {
    const agent = await prisma.agent.findUnique({
      where: { userId: String(payload.agentUserId) },
      select: { id: true },
    });
    if (!agent) return { ready: false, reason: "agent not found" };
    return isAgentProviderReady(agent.id);
  },

  async buildRunInput(payload) {
    const projectId = String(payload.projectId);
    const project = await projectsDb.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        title: true,
        installationId: true,
        catalogEntity: { select: { repoUrl: true } },
      },
    });
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const branch =
      typeof payload.branch === "string" && payload.branch ? payload.branch : undefined;
    return {
      instruction: String(payload.instruction),
      repo: {
        repoUrl: project.catalogEntity?.repoUrl ?? null,
        installationId: project.installationId,
      },
      branch,
      project: { id: project.id, title: project.title },
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
    };
  },

  async interpret({ payload, result }) {
    if (isTransientRunError(result)) return { status: "retry", lastError: result.error };

    const summary = result.finalText?.trim() || "Coding run finished.";
    await notifyCodingCompleted({
      recipientUserId: String(payload.initiatorUserId),
      projectId: String(payload.projectId),
      projectTitle: String(payload.projectTitle ?? ""),
      summary,
    });
    return { status: "done" };
  },
};

export function registerProjectAgentTaskHandlers(): void {
  registerAgentTaskHandler(TASK_KIND, projectTaskHandler);
  registerAgentTaskHandler(CODING_ADHOC_KIND, codingAdhocHandler);
}

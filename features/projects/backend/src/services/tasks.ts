import { projectsDb } from "@internal/db";
import { meetsLevel, resolveAccess, visibleProjectIds } from "./permissions";
import { taskDto, TASK_INCLUDE, type TaskDto } from "./dto";
import { notifyTaskUpdated, taskNotificationRecipients, type TaskChanges } from "./notifications";

// Task operations shared by the agent tools and the HTTP routes. Each returns a result object
// (either the data or an `error` string) so a tool can hand it straight back to the model.

type SubtaskResult = { subtask: TaskDto } | { error: string };
type SubtaskListResult = { subtasks: TaskDto[] } | { error: string };
type TaskResult = { task: TaskDto } | { error: string };
type TaskListResult = { tasks: TaskDto[] } | { error: string };

export async function createSubtask(input: {
  userId: string;
  parentTaskId: string;
  title: string;
  description?: string | null;
}): Promise<SubtaskResult> {
  const title = input.title?.trim();
  if (!title) return { error: "title is required" };

  const parent = await projectsDb.task.findUnique({
    where: { id: input.parentTaskId },
    select: { id: true, projectId: true, bucketId: true },
  });
  if (!parent) return { error: `Parent task "${input.parentTaskId}" not found` };

  const access = await resolveAccess(input.userId, parent.projectId);
  if (!access) return { error: "Project not found" };
  if (!meetsLevel(access, "write")) return { error: "Write permission required" };

  const created = await projectsDb.task.create({
    data: {
      projectId: parent.projectId,
      parentTaskId: parent.id,
      bucketId: parent.bucketId,
      title,
      description: input.description?.trim() || null,
      createdByUserId: input.userId,
    },
    include: TASK_INCLUDE,
  });
  return { subtask: taskDto(created) };
}

export async function listSubtasks(input: {
  userId: string;
  parentTaskId: string;
}): Promise<SubtaskListResult> {
  const parent = await projectsDb.task.findUnique({
    where: { id: input.parentTaskId },
    select: { id: true, projectId: true },
  });
  if (!parent) return { error: `Task "${input.parentTaskId}" not found` };

  const access = await resolveAccess(input.userId, parent.projectId);
  if (!access) return { error: "Project not found" };

  const children = await projectsDb.task.findMany({
    where: { parentTaskId: parent.id },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: TASK_INCLUDE,
  });
  return { subtasks: children.map(taskDto) };
}

export async function getTask(input: { userId: string; taskId: string }): Promise<TaskResult> {
  const task = await projectsDb.task.findUnique({
    where: { id: input.taskId },
    include: TASK_INCLUDE,
  });
  if (!task) return { error: "Task not found" };

  const access = await resolveAccess(input.userId, task.projectId);
  if (!access) return { error: "Task not found" };

  return { task: taskDto(task) };
}

export async function createTask(input: {
  userId: string;
  projectId: string;
  title: string;
  description?: string | null;
  bucketId?: string | null;
}): Promise<TaskResult> {
  const title = input.title?.trim();
  if (!title) return { error: "title is required" };

  const access = await resolveAccess(input.userId, input.projectId);
  if (!access) return { error: "Project not found" };
  if (!meetsLevel(access, "write")) return { error: "Write permission required" };

  if (input.bucketId) {
    const bucket = await projectsDb.bucket.findFirst({
      where: { id: input.bucketId, projectId: input.projectId },
      select: { id: true },
    });
    if (!bucket) return { error: "Bucket does not belong to this project" };
  }

  const created = await projectsDb.task.create({
    data: {
      projectId: input.projectId,
      bucketId: input.bucketId ?? null,
      title,
      description: input.description?.trim() || null,
      createdByUserId: input.userId,
    },
    include: TASK_INCLUDE,
  });
  return { task: taskDto(created) };
}

// Moves a task across kanban columns and/or flips its done flag, notifying the task audience of the
// change just like the HTTP patch path does.
export async function moveTask(input: {
  userId: string;
  taskId: string;
  bucketId?: string | null;
  done?: boolean;
  position?: number;
}): Promise<TaskResult> {
  const existing = await projectsDb.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      projectId: true,
      done: true,
      bucketId: true,
      assignees: { select: { userId: true } },
      project: { select: { id: true, title: true, creatorUserId: true } },
    },
  });
  if (!existing) return { error: "Task not found" };

  const access = await resolveAccess(input.userId, existing.projectId);
  if (!access) return { error: "Task not found" };
  if (!meetsLevel(access, "write")) return { error: "Write permission required" };

  if (input.bucketId) {
    const bucket = await projectsDb.bucket.findFirst({
      where: { id: input.bucketId, projectId: existing.projectId },
      select: { id: true },
    });
    if (!bucket) return { error: "Bucket does not belong to this project" };
  }

  const changes: TaskChanges = {};
  if (input.done !== undefined && input.done !== existing.done) {
    changes.done = { from: existing.done, to: input.done };
  }
  if (input.bucketId !== undefined && input.bucketId !== existing.bucketId) {
    changes.bucket = { from: existing.bucketId, to: input.bucketId };
  }

  const updated = await projectsDb.$transaction(async (tx) => {
    const next = await tx.task.update({
      where: { id: existing.id },
      data: {
        ...(input.bucketId !== undefined ? { bucketId: input.bucketId } : {}),
        ...(input.done !== undefined ? { done: input.done } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      },
      include: TASK_INCLUDE,
    });
    const recipients = taskNotificationRecipients(existing, { excludeUserId: input.userId });
    if (Object.keys(changes).length > 0 && recipients.length > 0) {
      await notifyTaskUpdated(tx, {
        taskId: next.id,
        taskTitle: next.title,
        projectId: existing.project.id,
        projectTitle: existing.project.title,
        changes,
        recipientUserIds: recipients,
      });
    }
    return next;
  });
  return { task: taskDto(updated) };
}

export async function searchTasks(input: {
  userId: string;
  query: string;
  projectId?: string;
}): Promise<TaskListResult> {
  const q = input.query?.trim();
  if (!q) return { error: "query is required" };

  const visible = await visibleProjectIds(input.userId);
  let scope = visible;
  if (input.projectId) {
    if (!visible.includes(input.projectId)) return { error: "Project not found" };
    scope = [input.projectId];
  }
  if (scope.length === 0) return { tasks: [] };

  const tasks = await projectsDb.task.findMany({
    where: {
      projectId: { in: scope },
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    include: TASK_INCLUDE,
  });
  return { tasks: tasks.map(taskDto) };
}

export async function listMyTasks(input: { userId: string }): Promise<TaskListResult> {
  const tasks = await projectsDb.task.findMany({
    where: { assignees: { some: { userId: input.userId } }, done: false },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    include: TASK_INCLUDE,
  });
  return { tasks: tasks.map(taskDto) };
}

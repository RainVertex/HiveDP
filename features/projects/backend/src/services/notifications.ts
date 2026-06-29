import { projectsDb, Prisma } from "@internal/db";
import { notify } from "@feature/notifications-backend/contract";

interface TaskRef {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectTitle: string;
}

// Creator plus every assignee, minus the actor, deduped. The shared audience for task lifecycle events.
export function taskNotificationRecipients(
  task: { project: { creatorUserId: string | null }; assignees: { userId: string }[] },
  opts: { excludeUserId?: string } = {},
): string[] {
  const set = new Set<string>();
  if (task.project.creatorUserId) set.add(task.project.creatorUserId);
  for (const a of task.assignees) set.add(a.userId);
  if (opts.excludeUserId) set.delete(opts.excludeUserId);
  return [...set];
}

export interface TaskAssignedArgs extends TaskRef {
  recipientUserId: string;
}

export async function notifyTaskAssigned(args: TaskAssignedArgs): Promise<void> {
  await projectsDb.$transaction((tx) =>
    notify(tx, {
      recipientUserId: args.recipientUserId,
      kind: "projects.task.assigned",
      payload: {
        taskId: args.taskId,
        taskTitle: args.taskTitle,
        projectId: args.projectId,
        projectTitle: args.projectTitle,
      },
    }),
  );
}

export interface TaskCommentedArgs extends TaskRef {
  authorUserId: string;
  authorName: string;
  bodySnippet: string;
  recipientUserIds: string[];
}

export async function notifyTaskCommented(args: TaskCommentedArgs): Promise<void> {
  const recipients = args.recipientUserIds.filter((id) => id !== args.authorUserId);
  if (recipients.length === 0) return;

  await projectsDb.$transaction(async (tx) => {
    for (const recipientUserId of recipients) {
      await notify(tx, {
        recipientUserId,
        kind: "projects.task.commentAdded",
        payload: {
          taskId: args.taskId,
          taskTitle: args.taskTitle,
          projectId: args.projectId,
          projectTitle: args.projectTitle,
          authorName: args.authorName,
          bodySnippet: args.bodySnippet,
        },
      });
    }
  });
}

export interface CodingCompletedArgs {
  recipientUserId: string;
  projectId: string;
  projectTitle: string;
  summary: string;
}

// Notifies the user who triggered a standalone coding run (no task to comment on) with the outcome.
export async function notifyCodingCompleted(args: CodingCompletedArgs): Promise<void> {
  await projectsDb.$transaction((tx) =>
    notify(tx, {
      recipientUserId: args.recipientUserId,
      kind: "projects.coding.completed",
      payload: {
        projectId: args.projectId,
        projectTitle: args.projectTitle,
        summary: args.summary,
      },
    }),
  );
}

export interface TaskMentionedArgs extends TaskRef {
  authorName: string;
  bodySnippet: string;
  recipientUserIds: string[];
}

export async function notifyTaskMentioned(args: TaskMentionedArgs): Promise<void> {
  if (args.recipientUserIds.length === 0) return;

  await projectsDb.$transaction(async (tx) => {
    for (const recipientUserId of args.recipientUserIds) {
      await notify(tx, {
        recipientUserId,
        kind: "projects.task.mentioned",
        payload: {
          taskId: args.taskId,
          taskTitle: args.taskTitle,
          projectId: args.projectId,
          projectTitle: args.projectTitle,
          authorName: args.authorName,
          bodySnippet: args.bodySnippet,
        },
      });
    }
  });
}

export interface TaskChanges {
  done?: { from: boolean; to: boolean };
  bucket?: { from: string | null; to: string | null };
  dueDate?: { from: string | null; to: string | null };
  priority?: { from: number; to: number };
}

export async function notifyTaskUpdated(
  tx: Prisma.TransactionClient,
  args: TaskRef & { changes: TaskChanges; recipientUserIds: string[] },
): Promise<void> {
  for (const recipientUserId of args.recipientUserIds) {
    await notify(tx, {
      recipientUserId,
      kind: "projects.task.updated",
      payload: {
        taskId: args.taskId,
        taskTitle: args.taskTitle,
        projectId: args.projectId,
        projectTitle: args.projectTitle,
        changes: args.changes as Record<string, unknown>,
      },
    });
  }
}

export async function notifyTaskUnassigned(
  tx: Prisma.TransactionClient,
  args: TaskRef & { recipientUserId: string },
): Promise<void> {
  await notify(tx, {
    recipientUserId: args.recipientUserId,
    kind: "projects.task.unassigned",
    payload: {
      taskId: args.taskId,
      taskTitle: args.taskTitle,
      projectId: args.projectId,
      projectTitle: args.projectTitle,
    },
  });
}

export async function notifyTaskDueSoon(
  tx: Prisma.TransactionClient,
  args: TaskRef & { dueDate: string | null; recipientUserId: string },
): Promise<void> {
  await notify(tx, {
    recipientUserId: args.recipientUserId,
    kind: "projects.task.dueSoon",
    payload: {
      taskId: args.taskId,
      taskTitle: args.taskTitle,
      projectId: args.projectId,
      projectTitle: args.projectTitle,
      dueDate: args.dueDate,
    },
  });
}

interface ProjectMemberRef {
  projectId: string;
  projectTitle: string;
  recipientUserId: string;
}

export async function notifyProjectMemberAdded(
  tx: Prisma.TransactionClient,
  args: ProjectMemberRef & { role: string },
): Promise<void> {
  await notify(tx, {
    recipientUserId: args.recipientUserId,
    kind: "projects.member.added",
    payload: { projectId: args.projectId, projectTitle: args.projectTitle, role: args.role },
  });
}

export async function notifyProjectMemberPermissionChanged(
  tx: Prisma.TransactionClient,
  args: ProjectMemberRef & { role: string },
): Promise<void> {
  await notify(tx, {
    recipientUserId: args.recipientUserId,
    kind: "projects.member.permissionChanged",
    payload: { projectId: args.projectId, projectTitle: args.projectTitle, role: args.role },
  });
}

export async function notifyProjectMemberRemoved(
  tx: Prisma.TransactionClient,
  args: ProjectMemberRef,
): Promise<void> {
  await notify(tx, {
    recipientUserId: args.recipientUserId,
    kind: "projects.member.removed",
    payload: { projectId: args.projectId, projectTitle: args.projectTitle },
  });
}

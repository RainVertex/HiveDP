import { projectsDb } from "@internal/db";
import { notify } from "@feature/notifications-backend";

export interface TaskAssignedArgs {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectTitle: string;
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

export interface TaskCommentedArgs {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectTitle: string;
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

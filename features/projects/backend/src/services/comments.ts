import { projectsDb } from "@internal/db";
import { meetsLevel, resolveAccess } from "./permissions";
import { commentDto, type TaskCommentDto } from "./dto";
import {
  notifyTaskCommented,
  notifyTaskMentioned,
  taskNotificationRecipients,
} from "./notifications";

// Comment creation shared by the HTTP route and the agent tool. Returns a result object so a tool can
// hand it straight back to the model.
type CommentResult = { comment: TaskCommentDto } | { error: string };

export async function addComment(input: {
  userId: string;
  taskId: string;
  body: string;
}): Promise<CommentResult> {
  const body = input.body?.trim();
  if (!body) return { error: "body is required" };
  if (body.length > 10000) return { error: "body is too long" };

  const task = await projectsDb.task.findUnique({
    where: { id: input.taskId },
    include: {
      project: { select: { id: true, title: true, creatorUserId: true } },
      assignees: { select: { userId: true } },
    },
  });
  if (!task) return { error: "Task not found" };

  const access = await resolveAccess(input.userId, task.projectId);
  if (!access) return { error: "Task not found" };
  if (!meetsLevel(access, "write")) return { error: "Write permission required" };

  const created = await projectsDb.taskComment.create({
    data: { taskId: task.id, authorUserId: input.userId, body },
    include: { author: true },
  });

  const mentioned = await resolveMentions(body, task.projectId, input.userId);
  const taskRef = {
    taskId: task.id,
    taskTitle: task.title,
    projectId: task.project.id,
    projectTitle: task.project.title,
    authorName: created.author?.displayName ?? "",
    bodySnippet: body.slice(0, 200),
  };
  // A mentioned user gets the mention, never also the generic comment notification.
  const commentRecipients = taskNotificationRecipients(task, {
    excludeUserId: input.userId,
  }).filter((id) => !mentioned.includes(id));
  await notifyTaskMentioned({ ...taskRef, recipientUserIds: mentioned });
  await notifyTaskCommented({
    ...taskRef,
    authorUserId: input.userId,
    recipientUserIds: commentRecipients,
  });

  return { comment: commentDto(created) };
}

// Resolves @login tokens to user ids, keeping only users who can actually see the project and never the author.
async function resolveMentions(
  body: string,
  projectId: string,
  authorUserId: string,
): Promise<string[]> {
  const logins = [...new Set([...body.matchAll(/@([a-zA-Z0-9-]+)/g)].map((m) => m[1]))];
  if (logins.length === 0) return [];
  const candidates = await projectsDb.user.findMany({
    where: { githubLogin: { in: logins } },
    select: { id: true },
  });
  const resolved = await Promise.all(
    candidates.map(async (c) => ((await resolveAccess(c.id, projectId)) ? c.id : null)),
  );
  return resolved.filter((id): id is string => id !== null && id !== authorUserId);
}

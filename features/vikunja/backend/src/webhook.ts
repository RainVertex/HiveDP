import { prisma } from "@internal/db";
import { notify } from "@feature/notifications-backend";
import type { VikunjaWebhookPayload, VikunjaTask, VikunjaComment } from "@internal/vikunja-client";

async function upsertTask(task: VikunjaTask): Promise<void> {
  const projects = await prisma.vikunjaProject.findMany({
    where: { externalId: task.project_id },
    select: { id: true, ownerId: true, title: true },
  });

  const assigneeVikunjaIds = new Set((task.assignees ?? []).map((a) => a.id));

  for (const project of projects) {
    const bucketId = task.bucket_id
      ? ((
          await prisma.vikunjaBucket.findFirst({
            where: { externalId: task.bucket_id, projectId: project.id },
            select: { id: true },
          })
        )?.id ?? null)
      : null;

    const previous = await prisma.vikunjaTask.findUnique({
      where: { externalId_projectId: { externalId: task.id, projectId: project.id } },
      select: { assignees: true },
    });

    await prisma.vikunjaTask.upsert({
      where: { externalId_projectId: { externalId: task.id, projectId: project.id } },
      create: {
        externalId: task.id,
        projectId: project.id,
        title: task.title,
        description: task.description || null,
        done: task.done,
        bucketId,
        priority: task.priority,
        dueDate: task.due_date ? new Date(task.due_date) : null,
        position: task.position,
        assignees: task.assignees ? JSON.parse(JSON.stringify(task.assignees)) : undefined,
        labelIds: task.labels?.map((l) => l.id) ?? undefined,
        externalCreatedAt: new Date(task.created),
        externalUpdatedAt: new Date(task.updated),
      },
      update: {
        title: task.title,
        description: task.description || null,
        done: task.done,
        bucketId,
        priority: task.priority,
        dueDate: task.due_date ? new Date(task.due_date) : null,
        position: task.position,
        assignees: task.assignees ? JSON.parse(JSON.stringify(task.assignees)) : undefined,
        labelIds: task.labels?.map((l) => l.id) ?? undefined,
        externalUpdatedAt: new Date(task.updated),
      },
    });

    const previousAssigneeIds = new Set(
      Array.isArray(previous?.assignees)
        ? (previous!.assignees as Array<{ id: number }>).map((a) => a.id)
        : [],
    );
    const newlyAssignedVikunjaIds = [...assigneeVikunjaIds].filter(
      (vid) => !previousAssigneeIds.has(vid),
    );

    if (newlyAssignedVikunjaIds.length > 0) {
      for (const vikunjaUserId of newlyAssignedVikunjaIds) {
        const recipient = await resolvePlatformUser(vikunjaUserId, project.id);
        if (!recipient) continue;
        await prisma.$transaction((tx) =>
          notify(tx, {
            recipientUserId: recipient,
            kind: "vikunja.task.assigned",
            payload: {
              taskId: task.id,
              taskTitle: task.title,
              projectTitle: project.title,
              projectIdentifier: project.id,
            },
          }),
        );
      }
    }
  }
}

async function resolvePlatformUser(
  vikunjaUserId: number,
  projectMirrorId: string,
): Promise<string | null> {
  const project = await prisma.vikunjaProject.findUnique({
    where: { id: projectMirrorId },
    select: { ownerId: true, externalId: true },
  });
  if (!project) return null;

  const sameExt = await prisma.vikunjaProject.findMany({
    where: { externalId: project.externalId },
    select: { ownerId: true },
  });
  if (sameExt.length === 1) return sameExt[0].ownerId;

  return project.ownerId;
}

async function deleteTask(externalTaskId: number): Promise<void> {
  await prisma.vikunjaTask.deleteMany({ where: { externalId: externalTaskId } });
}

async function upsertComment(taskExternalId: number, comment: VikunjaComment): Promise<void> {
  const tasks = await prisma.vikunjaTask.findMany({
    where: { externalId: taskExternalId },
    select: { id: true, projectId: true, title: true },
  });

  for (const task of tasks) {
    const previous = await prisma.vikunjaComment.findUnique({
      where: { externalId_taskId: { externalId: comment.id, taskId: task.id } },
      select: { id: true },
    });

    await prisma.vikunjaComment.upsert({
      where: { externalId_taskId: { externalId: comment.id, taskId: task.id } },
      create: {
        externalId: comment.id,
        taskId: task.id,
        authorName: comment.author?.name ?? null,
        comment: comment.comment,
        externalCreatedAt: new Date(comment.created),
        externalUpdatedAt: new Date(comment.updated),
      },
      update: {
        comment: comment.comment,
        authorName: comment.author?.name ?? null,
        externalUpdatedAt: new Date(comment.updated),
      },
    });

    if (!previous) {
      const project = await prisma.vikunjaProject.findUnique({
        where: { id: task.projectId },
        select: { ownerId: true },
      });
      if (project) {
        await prisma.$transaction((tx) =>
          notify(tx, {
            recipientUserId: project.ownerId,
            kind: "vikunja.comment.posted",
            payload: {
              taskId: task.id,
              taskTitle: task.title,
              authorName: comment.author?.name ?? null,
              commentSnippet: comment.comment.slice(0, 200),
            },
          }),
        );
      }
    }
  }
}

export async function handleWebhookEvent(payload: VikunjaWebhookPayload): Promise<void> {
  const { event_name, data } = payload;

  switch (event_name) {
    case "task.created":
    case "task.updated":
    case "task.assigned":
      await upsertTask(data as VikunjaTask);
      break;
    case "task.deleted": {
      const deletedTask = data as VikunjaTask;
      await deleteTask(deletedTask.id);
      break;
    }
    case "task.comment.created":
    case "comment.created": {
      const commentData = data as { task: VikunjaTask; comment: VikunjaComment };
      await upsertComment(commentData.task.id, commentData.comment);
      break;
    }
  }
}

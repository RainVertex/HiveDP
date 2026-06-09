import type { Project, ProjectMember, Bucket, Task, Label, TaskComment, User } from "@internal/db";
import type {
  UserSummaryDto,
  ProjectDto,
  BucketDto,
  LabelDto,
  TaskDto,
  TaskCommentDto,
  ProjectShareDto,
} from "@internal/shared-types";
import { roleToNumeric } from "./permissions";

export type {
  UserSummaryDto,
  ProjectDto,
  BucketDto,
  LabelDto,
  TaskDto,
  TaskCommentDto,
  ProjectShareDto,
};

export function userSummary(
  user: Pick<User, "id" | "githubLogin" | "displayName"> | null | undefined,
): UserSummaryDto | null {
  if (!user) return null;
  return { id: user.id, username: user.githubLogin, name: user.displayName };
}

export function projectDto(
  project: Project & { creator?: User | null; _count?: { tasks: number } | null },
  maxPermission: 0 | 1 | 2,
): ProjectDto {
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    hexColor: project.hexColor,
    isArchived: project.isArchived,
    isAutoProvisioned: project.catalogEntityId !== null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    taskCount: project._count?.tasks ?? 0,
    maxPermission,
    owner: userSummary(project.creator ?? null),
  };
}

export function bucketDto(bucket: Bucket): BucketDto {
  return {
    id: bucket.id,
    projectId: bucket.projectId,
    title: bucket.title,
    position: bucket.position,
    taskLimit: bucket.taskLimit,
  };
}

export function labelDto(label: Label): LabelDto {
  return {
    id: label.id,
    projectId: label.projectId,
    title: label.title,
    hexColor: label.hexColor,
  };
}

type TaskWithRelations = Task & {
  assignees?: Array<{ user: Pick<User, "id" | "githubLogin" | "displayName"> }>;
  labels?: Array<{ label: Label }>;
  project?: { title: string } | null;
};

export function taskDto(task: TaskWithRelations): TaskDto {
  return {
    id: task.id,
    projectId: task.projectId,
    bucketId: task.bucketId,
    title: task.title,
    description: task.description,
    done: task.done,
    priority: task.priority,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    startDate: task.startDate ? task.startDate.toISOString() : null,
    endDate: task.endDate ? task.endDate.toISOString() : null,
    percentDone: task.percentDone,
    isFavorite: task.isFavorite,
    position: task.position,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    assignees: (task.assignees ?? [])
      .map((a) => userSummary(a.user))
      .filter((u): u is UserSummaryDto => u !== null),
    labels: (task.labels ?? []).map((l) => labelDto(l.label)),
    projectTitle: task.project?.title,
  };
}

export function commentDto(comment: TaskComment & { author?: User | null }): TaskCommentDto {
  return {
    id: comment.id,
    taskId: comment.taskId,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
    author: userSummary(comment.author ?? null),
  };
}

export function shareDto(
  member: ProjectMember & { user: Pick<User, "id" | "githubLogin" | "displayName"> },
): ProjectShareDto {
  return {
    id: member.user.id,
    username: member.user.githubLogin,
    name: member.user.displayName,
    permission: roleToNumeric(member.role),
  };
}

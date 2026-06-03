import type { Project, ProjectMember, Bucket, Task, Label, TaskComment, User } from "@internal/db";
import type { UserSummaryDto } from "@internal/shared-types";
import { roleToNumeric } from "./permissions";

export type { UserSummaryDto };

export function userSummary(
  user: Pick<User, "id" | "githubLogin" | "displayName"> | null | undefined,
): UserSummaryDto | null {
  if (!user) return null;
  return { id: user.id, username: user.githubLogin, name: user.displayName };
}

export interface ProjectDto {
  id: string;
  title: string;
  description: string | null;
  hexColor: string | null;
  isArchived: boolean;
  isAutoProvisioned: boolean;
  createdAt: string;
  updatedAt: string;
  taskCount: number;
  maxPermission: 0 | 1 | 2;
  owner: UserSummaryDto | null;
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

export interface BucketDto {
  id: string;
  projectId: string;
  title: string;
  position: number;
  taskLimit: number | null;
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

export interface LabelDto {
  id: string;
  projectId: string;
  title: string;
  hexColor: string | null;
}

export function labelDto(label: Label): LabelDto {
  return {
    id: label.id,
    projectId: label.projectId,
    title: label.title,
    hexColor: label.hexColor,
  };
}

export interface TaskDto {
  id: string;
  projectId: string;
  bucketId: string | null;
  title: string;
  description: string | null;
  done: boolean;
  priority: number;
  dueDate: string | null;
  startDate: string | null;
  endDate: string | null;
  percentDone: number;
  isFavorite: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  assignees: UserSummaryDto[];
  labels: LabelDto[];
  projectTitle?: string;
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

export interface TaskCommentDto {
  id: string;
  taskId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: UserSummaryDto | null;
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

export interface ProjectShareDto {
  id: string;
  username: string;
  name: string;
  permission: 0 | 1 | 2;
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

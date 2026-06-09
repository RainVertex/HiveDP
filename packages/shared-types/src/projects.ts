// DTOs for the projects feature.
import type { UserSummaryDto } from "./user";

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

export interface BucketDto {
  id: string;
  projectId: string;
  title: string;
  position: number;
  taskLimit: number | null;
}

export interface LabelDto {
  id: string;
  projectId: string;
  title: string;
  hexColor: string | null;
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

export interface TaskCommentDto {
  id: string;
  taskId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: UserSummaryDto | null;
}

export interface ProjectShareDto {
  id: string;
  username: string;
  name: string;
  permission: 0 | 1 | 2;
}

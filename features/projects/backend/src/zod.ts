import { z } from "zod";

export const createProjectSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10000).optional(),
  hexColor: z.string().optional(),
});

export const updateProjectSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10000).nullable().optional(),
  isArchived: z.boolean().optional(),
  hexColor: z.string().nullable().optional(),
});

export const codingRunSchema = z.object({
  agentId: z.string().min(1),
  instruction: z.string().min(1).max(20000),
  branch: z.string().max(200).optional(),
});

export const createTaskSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  priority: z.number().int().min(0).max(4).optional(),
  dueDate: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  bucketId: z.string().nullable().optional(),
  position: z.number().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().nullable().optional(),
  done: z.boolean().optional(),
  priority: z.number().int().min(0).max(4).optional(),
  dueDate: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  percentDone: z.number().min(0).max(1).optional(),
  isFavorite: z.boolean().optional(),
  bucketId: z.string().nullable().optional(),
  position: z.number().optional(),
});

export const createBucketSchema = z.object({
  title: z.string().min(1).max(200),
  position: z.number().optional(),
  taskLimit: z.number().int().min(0).nullable().optional(),
});

export const updateBucketSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  position: z.number().optional(),
  taskLimit: z.number().int().min(0).nullable().optional(),
});

export const createLabelSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(200),
  hexColor: z.string().optional(),
});

export const attachLabelSchema = z.object({
  labelId: z.string().min(1),
});

export const createCommentSchema = z.object({
  body: z.string().min(1).max(10000),
});

export const addAssigneeSchema = z.object({
  username: z.string().min(1),
});

export const addShareSchema = z.object({
  username: z.string().min(1),
  right: z.number().int().min(0).max(4).optional(),
});

export const updateShareSchema = z.object({
  right: z.number().int().min(0).max(4),
});

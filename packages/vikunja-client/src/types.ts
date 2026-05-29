export interface VikunjaClientConfig {
  baseUrl: string;
  token: string;
}

export interface VikunjaProject {
  id: number;
  title: string;
  description: string;
  identifier: string;
  hex_color: string;
  is_archived: boolean;
  background_information: unknown;
  background_blur_hash: string;
  is_favorite: boolean;
  parent_project_id?: number;
  position: number;
  created: string;
  updated: string;
  owner: VikunjaUser;
  max_permission?: number;
}

export interface VikunjaUser {
  id: number;
  name: string;
  username: string;
  email: string;
  created: string;
  updated: string;
}

export interface VikunjaTask {
  id: number;
  title: string;
  description: string;
  done: boolean;
  done_at: string | null;
  due_date: string | null;
  start_date: string | null;
  end_date: string | null;
  priority: number;
  percent_done: number;
  position: number;
  bucket_id: number;
  project_id: number;
  created: string;
  updated: string;
  created_by: VikunjaUser;
  assignees: VikunjaUser[] | null;
  labels: VikunjaLabel[] | null;
  is_favorite: boolean;
  identifier: string;
  index: number;
}

export interface VikunjaBucket {
  id: number;
  title: string;
  project_id: number;
  project_view_id?: number;
  position: number;
  limit: number;
  count?: number;
  is_done_bucket?: boolean;
  tasks?: VikunjaTask[];
  created: string;
  updated: string;
  created_by?: VikunjaUser;
}

export interface VikunjaView {
  id: number;
  title: string;
  project_id: number;
  view_kind: string;
  position: number;
  created: string;
  updated: string;
}

export interface VikunjaLabel {
  id: number;
  title: string;
  description: string;
  hex_color: string;
  created: string;
  updated: string;
  created_by: VikunjaUser;
}

export interface VikunjaComment {
  id: number;
  comment: string;
  author: VikunjaUser;
  created: string;
  updated: string;
}

export interface VikunjaTokenResponse {
  token: string;
}

export interface VikunjaWebhookPayload {
  event_name: string;
  time: string;
  data: unknown;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: number;
  due_date?: string;
  bucket_id?: number;
  assignees?: Array<{ id: number }>;
  labels?: Array<{ id: number }>;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  done?: boolean;
  priority?: number;
  due_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  percent_done?: number;
  is_favorite?: boolean;
  bucket_id?: number;
  position?: number;
  assignees?: Array<{ id: number }>;
  labels?: Array<{ id: number }>;
}

export interface CreateBucketInput {
  title: string;
  position?: number;
  limit?: number;
}

export interface UpdateBucketInput {
  title?: string;
  position?: number;
  limit?: number;
}

export interface CreateCommentInput {
  comment: string;
}

export interface CreateProjectInput {
  title: string;
  description?: string;
  hex_color?: string;
}

export interface TaskFilters {
  page?: number;
  per_page?: number;
  s?: string;
  sort_by?: string;
  order_by?: string;
  filter?: string;
}

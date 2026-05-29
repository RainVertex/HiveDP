import type {
  VikunjaBucket,
  VikunjaClientConfig,
  VikunjaComment,
  VikunjaLabel,
  VikunjaProject,
  VikunjaTask,
  VikunjaUser,
  VikunjaView,
  CreateTaskInput,
  UpdateTaskInput,
  CreateBucketInput,
  UpdateBucketInput,
  CreateCommentInput,
  CreateProjectInput,
  TaskFilters,
} from "./types";

export class VikunjaApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: string,
  ) {
    super(message);
    this.name = "VikunjaApiError";
  }
}

export class VikunjaClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: VikunjaClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
    const res = await fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new VikunjaApiError(res.status, `Vikunja ${method} ${path}: ${res.status}`, text);
    }
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  // Projects
  async listProjects(): Promise<VikunjaProject[]> {
    const all: VikunjaProject[] = [];
    let page = 1;
    while (true) {
      const batch = await this.request<VikunjaProject[]>(
        "GET",
        `/projects?page=${page}&per_page=50&is_archived=true`,
      );
      if (!batch || batch.length === 0) break;
      all.push(...batch);
      if (batch.length < 50) break;
      page++;
    }
    return all;
  }

  async getProject(id: number): Promise<VikunjaProject> {
    return this.request<VikunjaProject>("GET", `/projects/${id}?expand=permissions`);
  }

  async createProject(input: CreateProjectInput): Promise<VikunjaProject> {
    return this.request<VikunjaProject>("PUT", "/projects", input);
  }

  async updateProject(
    id: number,
    input: { title?: string; description?: string; is_archived?: boolean; hex_color?: string },
  ): Promise<VikunjaProject> {
    return this.request<VikunjaProject>("POST", `/projects/${id}`, input);
  }

  async deleteProject(id: number): Promise<void> {
    await this.request<unknown>("DELETE", `/projects/${id}`);
  }

  // Tasks
  async listTasks(projectId: number, filters?: TaskFilters): Promise<VikunjaTask[]> {
    const params = new URLSearchParams();
    if (filters) {
      for (const [key, val] of Object.entries(filters)) {
        if (val != null) params.set(key, String(val));
      }
    }
    const qs = params.toString();
    return this.request<VikunjaTask[]>("GET", `/projects/${projectId}/tasks${qs ? `?${qs}` : ""}`);
  }

  async getTask(id: number): Promise<VikunjaTask> {
    return this.request<VikunjaTask>("GET", `/tasks/${id}`);
  }

  async createTask(projectId: number, input: CreateTaskInput): Promise<VikunjaTask> {
    return this.request<VikunjaTask>("PUT", `/projects/${projectId}/tasks`, input);
  }

  async updateTask(id: number, input: UpdateTaskInput): Promise<VikunjaTask> {
    return this.request<VikunjaTask>("POST", `/tasks/${id}`, input);
  }

  async deleteTask(id: number): Promise<void> {
    await this.request<unknown>("DELETE", `/tasks/${id}`);
  }

  // Views
  async listViews(projectId: number): Promise<VikunjaView[]> {
    return this.request<VikunjaView[]>("GET", `/projects/${projectId}/views`);
  }

  // Vikunja v2's /views/:view/tasks endpoint returns buckets with tasks nested inside,
  // not a flat task list. This is the accurate source for kanban task-bucket assignment.
  async listKanbanBuckets(projectId: number, viewId: number): Promise<VikunjaBucket[]> {
    return this.request<VikunjaBucket[]>("GET", `/projects/${projectId}/views/${viewId}/tasks`);
  }

  async assignTaskToBucket(
    projectId: number,
    viewId: number,
    bucketId: number,
    taskId: number,
  ): Promise<void> {
    await this.request<unknown>(
      "POST",
      `/projects/${projectId}/views/${viewId}/buckets/${bucketId}/tasks`,
      { task_id: taskId, bucket_id: bucketId, project_view_id: viewId },
    );
  }

  // Buckets (kanban columns, scoped to a view in v2)
  async listBuckets(projectId: number, viewId: number): Promise<VikunjaBucket[]> {
    return this.request<VikunjaBucket[]>("GET", `/projects/${projectId}/views/${viewId}/buckets`);
  }

  async createBucket(
    projectId: number,
    viewId: number,
    input: CreateBucketInput,
  ): Promise<VikunjaBucket> {
    return this.request<VikunjaBucket>(
      "PUT",
      `/projects/${projectId}/views/${viewId}/buckets`,
      input,
    );
  }

  async updateBucket(
    projectId: number,
    viewId: number,
    bucketId: number,
    input: UpdateBucketInput,
  ): Promise<VikunjaBucket> {
    return this.request<VikunjaBucket>(
      "POST",
      `/projects/${projectId}/views/${viewId}/buckets/${bucketId}`,
      input,
    );
  }

  async deleteBucket(projectId: number, viewId: number, bucketId: number): Promise<void> {
    await this.request<unknown>(
      "DELETE",
      `/projects/${projectId}/views/${viewId}/buckets/${bucketId}`,
    );
  }

  // Project sharing
  async listProjectUsers(
    projectId: number,
  ): Promise<Array<{ id: number; username: string; permission: number }>> {
    return this.request<Array<{ id: number; username: string; permission: number }>>(
      "GET",
      `/projects/${projectId}/users`,
    );
  }

  async addProjectUser(
    projectId: number,
    input: { username: string; permission: number },
  ): Promise<{ id: number; username: string; permission: number }> {
    return this.request<{ id: number; username: string; permission: number }>(
      "PUT",
      `/projects/${projectId}/users`,
      input,
    );
  }

  async updateProjectUser(
    projectId: number,
    userId: number,
    input: { permission: number },
  ): Promise<{ id: number; username: string; permission: number }> {
    return this.request<{ id: number; username: string; permission: number }>(
      "POST",
      `/projects/${projectId}/users/${userId}`,
      input,
    );
  }

  async removeProjectUser(projectId: number, userId: number): Promise<void> {
    await this.request<unknown>("DELETE", `/projects/${projectId}/users/${userId}`);
  }

  // User settings
  async updateUserSettings(settings: Record<string, unknown>): Promise<void> {
    await this.request<unknown>("POST", "/user/settings/general", settings);
  }

  // User search
  async searchUsers(query: string): Promise<Array<{ id: number; username: string; name: string }>> {
    return this.request<Array<{ id: number; username: string; name: string }>>(
      "GET",
      `/users?s=${encodeURIComponent(query)}`,
    );
  }

  // Task labels
  async addTaskLabel(taskId: number, labelId: number): Promise<{ label_id: number }> {
    return this.request<{ label_id: number }>("PUT", `/tasks/${taskId}/labels`, {
      label_id: labelId,
    });
  }

  async removeTaskLabel(taskId: number, labelId: number): Promise<void> {
    await this.request<unknown>("DELETE", `/tasks/${taskId}/labels/${labelId}`);
  }

  async createLabel(input: { title: string; hex_color?: string }): Promise<VikunjaLabel> {
    return this.request<VikunjaLabel>("PUT", `/labels`, input);
  }

  // Project webhooks
  async listProjectWebhooks(
    projectId: number,
  ): Promise<Array<{ id: number; target_url: string; events: string[] }>> {
    return this.request<Array<{ id: number; target_url: string; events: string[] }>>(
      "GET",
      `/projects/${projectId}/webhooks`,
    );
  }

  async createProjectWebhook(
    projectId: number,
    input: { target_url: string; events: string[]; secret?: string },
  ): Promise<{ id: number; target_url: string; events: string[] }> {
    return this.request<{ id: number; target_url: string; events: string[] }>(
      "PUT",
      `/projects/${projectId}/webhooks`,
      input,
    );
  }

  async deleteProjectWebhook(projectId: number, webhookId: number): Promise<void> {
    await this.request<unknown>("DELETE", `/projects/${projectId}/webhooks/${webhookId}`);
  }

  // Comments
  async listComments(taskId: number): Promise<VikunjaComment[]> {
    return this.request<VikunjaComment[]>("GET", `/tasks/${taskId}/comments`);
  }

  async createComment(taskId: number, input: CreateCommentInput): Promise<VikunjaComment> {
    return this.request<VikunjaComment>("PUT", `/tasks/${taskId}/comments`, input);
  }

  // Labels
  async listLabels(): Promise<VikunjaLabel[]> {
    return this.request<VikunjaLabel[]>("GET", "/labels");
  }

  // Users
  async getCurrentUser(): Promise<VikunjaUser> {
    return this.request<VikunjaUser>("GET", "/user");
  }

  // Assignees
  async addAssignee(taskId: number, userId: number): Promise<void> {
    await this.request<unknown>("PUT", `/tasks/${taskId}/assignees`, { user_id: userId });
  }

  async removeAssignee(taskId: number, userId: number): Promise<void> {
    await this.request<unknown>("DELETE", `/tasks/${taskId}/assignees/${userId}`);
  }
}

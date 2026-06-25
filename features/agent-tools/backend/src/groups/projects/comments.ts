import type { RegisteredTool } from "@internal/llm-core";
import { addComment } from "@feature/projects-backend/contract";
import { requireUserId } from "../core";

export const commentOnTaskTool: RegisteredTool = {
  id: "projects_comment_on_task",
  openaiDef: {
    type: "function",
    function: {
      name: "projects_comment_on_task",
      description:
        "Add a comment to a task. Requires write access on the project. Mention a user with @their-username to notify them directly, everyone else watching the task is notified of the comment.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Id of the task to comment on." },
          body: {
            type: "string",
            description: "The comment text. Use @username to mention and notify someone.",
          },
        },
        required: ["taskId", "body"],
      },
    },
  },
  handler: async (args, ctx) => {
    const userId = requireUserId(ctx);
    const { taskId, body } = args as { taskId: string; body: string };
    return addComment({ userId, taskId, body });
  },
};

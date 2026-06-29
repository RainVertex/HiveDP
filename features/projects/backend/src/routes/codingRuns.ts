import { Router } from "express";
// eslint-disable-next-line no-restricted-imports -- the Agent model is not in projectsDb, so the agent read needs the raw prisma singleton.
import { prisma } from "@internal/db";
import { codingRunSchema } from "../zod";
import { meetsLevel, resolveAccess } from "../services/permissions";
import { enqueueCodingRun } from "../services/agentRuns";

export const codingRunsRoutes: Router = Router();

// Standalone coding run: trigger a coding agent on a project with a free-text instruction (no task).
// The agent opens a draft PR and notifies the caller when it finishes.
codingRunsRoutes.post("/projects/:id/coding-runs", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const access = await resolveAccess(userId, req.params.id);
    if (!access) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!meetsLevel(access, "write")) {
      res.status(403).json({ error: "Write permission required" });
      return;
    }
    const input = codingRunSchema.parse(req.body);

    const agent = await prisma.agent.findUnique({
      where: { id: input.agentId },
      select: { userId: true, runtime: true },
    });
    if (!agent || !agent.userId) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    if (agent.runtime !== "code") {
      res.status(400).json({ error: "Selected agent is not a coding agent" });
      return;
    }

    await enqueueCodingRun({
      agentUserId: agent.userId,
      projectId: req.params.id,
      instruction: input.instruction,
      branch: input.branch,
      initiatorUserId: userId,
    });
    res.status(202).json({ status: "queued" });
  } catch (err) {
    next(err);
  }
});

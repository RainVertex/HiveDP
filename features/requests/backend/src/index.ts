// Requests feature backend: sidebar pending-summary endpoint for team and maintainer requests.
import { Router } from "express";
import { prisma } from "@internal/db";

export const requestsRouter: Router = Router();

/** Sidebar-poll endpoint: counts of pending items the user can act on, plus a `canApprove` flag */
requestsRouter.get("/pending-summary", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const myId = req.user.id;
    const isAdmin = req.user.role === "admin";

    const [
      myTeamRequestsPending,
      myMaintainerRequestsPending,
      iAmLead,
      maintainerApprovalsPending,
      teamCreationApprovalsPending,
    ] = await Promise.all([
      prisma.teamRequest.count({
        where: {
          requestedByUserId: myId,
          status: { in: ["pending", "awaiting_user_confirmation"] },
        },
      }),
      prisma.maintainerRequest.count({
        where: { requestedByUserId: myId, status: "pending" },
      }),
      // Cheap "do I lead any team" check, reused for canApprove.
      prisma.teamMembership.findFirst({
        where: { userId: myId, role: "lead" },
        select: { teamId: true },
      }),
      prisma.maintainerRequest.count({
        where: isAdmin
          ? { status: "pending", requestedByUserId: { not: myId } }
          : {
              status: "pending",
              requestedByUserId: { not: myId },
              team: {
                memberships: { some: { userId: myId, role: "lead" } },
              },
            },
      }),
      // Team-creation approvals are admin-only, non-admins always see 0.
      isAdmin
        ? prisma.teamRequest.count({
            where: { status: { in: ["pending", "awaiting_user_confirmation"] } },
          })
        : Promise.resolve(0),
    ]);

    const canApprove = isAdmin || !!iAmLead;
    res.json({
      myRequestsPending: myTeamRequestsPending + myMaintainerRequestsPending,
      myApprovalsPending: canApprove
        ? maintainerApprovalsPending + teamCreationApprovalsPending
        : 0,
      canApprove,
    });
  } catch (err) {
    next(err);
  }
});

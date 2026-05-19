import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { UserRole } from "@internal/db";
import { readSessionCookie, validateSession } from "../auth/session";

export const optionalAuth: RequestHandler = async (req, _res, next) => {
  try {
    const raw = readSessionCookie(req);
    const user = await validateSession(raw);
    if (user) req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const raw = readSessionCookie(req);
    const user = await validateSession(raw);
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

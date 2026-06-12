import type { User } from "@internal/db";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      id?: string;
    }
  }
}

export {};

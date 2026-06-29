import type { User } from "@internal/db";

// The worker transitively compiles feature route files (pulled in via the feature index barrels) that
// reference req.user, so it carries the same ambient Express augmentation the API shell does.
declare global {
  namespace Express {
    interface Request {
      user?: User;
      id?: string;
    }
  }
}

export {};

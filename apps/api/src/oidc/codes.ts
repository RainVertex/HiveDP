import { randomBytes } from "node:crypto";

interface AuthorizationCode {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  githubLogin: string;
  clientId: string;
  redirectUri: string;
  expiresAt: number;
  used: boolean;
}

const store = new Map<string, AuthorizationCode>();

const CODE_TTL_MS = 60_000;

export function issueCode(params: Omit<AuthorizationCode, "expiresAt" | "used">): string {
  const code = randomBytes(32).toString("base64url");
  store.set(code, { ...params, expiresAt: Date.now() + CODE_TTL_MS, used: false });
  return code;
}

export function consumeCode(code: string, clientId: string): AuthorizationCode | null {
  const entry = store.get(code);
  if (!entry) return null;
  if (entry.used || entry.expiresAt < Date.now() || entry.clientId !== clientId) {
    store.delete(code);
    return null;
  }
  entry.used = true;
  store.delete(code);
  return entry;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of store) {
    if (val.expiresAt < now) store.delete(key);
  }
}, 60_000);

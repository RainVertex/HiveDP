import { z } from "zod";

const NodeEnv = z.enum(["development", "production", "test"]).default("development");

const schema = z.object({
  NODE_ENV: NodeEnv,
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.url().default("http://localhost:3010"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  GITHUB_CLIENT_ID: z.string().min(1, "GITHUB_CLIENT_ID is required"),
  GITHUB_CLIENT_SECRET: z.string().min(1, "GITHUB_CLIENT_SECRET is required"),
  AUTH_CALLBACK_URL: z.url().optional(),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_COOKIE_NAME: z.string().min(1).default("mep_sid"),

  BOOTSTRAP_ADMIN_EMAIL: z
    .union([z.email(), z.literal("")])
    .optional()
    .transform((v) => (v ? v.toLowerCase() : "")),

  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).optional(),
});

export interface AppEnv {
  nodeEnv: "development" | "production" | "test";
  port: number;
  webOrigin: string;
  databaseUrl: string;
  sessionSecret: string;
  sessionCookieName: string;
  sessionMaxAgeMs: number;
  github: {
    clientId: string;
    clientSecret: string;
    authCallbackUrl: string;
  };
  bootstrapAdminEmail: string;
}

let cached: AppEnv | null = null;

export function loadEnv(): AppEnv {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
  }

  const data = parsed.data;
  const port = data.API_PORT;

  cached = {
    nodeEnv: data.NODE_ENV,
    port,
    webOrigin: data.WEB_ORIGIN,
    databaseUrl: data.DATABASE_URL,
    sessionSecret: data.SESSION_SECRET,
    sessionCookieName: data.SESSION_COOKIE_NAME,
    sessionMaxAgeMs: 1000 * 60 * 60 * 24 * 30,
    github: {
      clientId: data.GITHUB_CLIENT_ID,
      clientSecret: data.GITHUB_CLIENT_SECRET,
      authCallbackUrl: data.AUTH_CALLBACK_URL ?? `http://localhost:${port}/auth/github/callback`,
    },
    bootstrapAdminEmail: data.BOOTSTRAP_ADMIN_EMAIL,
  };

  return cached;
}

export function resetEnvCache() {
  cached = null;
}

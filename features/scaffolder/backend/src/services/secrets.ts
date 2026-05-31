// Loads platform-managed secrets for the apply path, currently only env vars prefixed SCAFFOLDER_SECRET_.

const PREFIX = "SCAFFOLDER_SECRET_";

export function loadEnvSecrets(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith(PREFIX) && v) {
      out[k.slice(PREFIX.length)] = v;
    }
  }
  return out;
}

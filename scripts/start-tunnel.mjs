// Starts an ngrok tunnel against the platform backend (API_PORT, default 4000)
//
// Runs as part of `yarn dev` via concurrently. To skip the tunnel for a
// session, run the workspaces directly: `yarn dev:app` + `yarn dev:backend`.

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });

const port = Number(process.env.API_PORT ?? 4000);
const authtoken = process.env.NGROK_AUTHTOKEN;

if (!authtoken) {
  console.log(
    "[tunnel] NGROK_AUTHTOKEN not set — skipping tunnel.\n" +
      "[tunnel] To enable: get a free token at https://dashboard.ngrok.com/get-started/your-authtoken" +
      "\n[tunnel] then set NGROK_AUTHTOKEN=<token> in .env and restart `yarn dev`.",
  );
  process.exit(0);
}

let ngrok;
try {
  ngrok = await import("@ngrok/ngrok");
} catch (err) {
  console.error(
    "[tunnel] Failed to load ngrok. Run `yarn install` and try again.\n" +
      `[tunnel] ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}

console.log(`[tunnel] Starting ngrok forwarder for port ${port}…`);

let listener;
try {
  listener = await ngrok.forward({ addr: port, authtoken });
} catch (err) {
  console.error(
    `[tunnel] ngrok failed to start: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}

const url = listener.url();
console.log(`[tunnel] ✓ Public URL: ${url}`);
console.log(`[tunnel]   Plane webhook payload URL pattern:`);
console.log(`[tunnel]     ${url}/integrations/plane/webhook/<integration-id>`);
console.log(`[tunnel]   GitHub App webhook payload URL:`);
console.log(`[tunnel]     ${url}/integrations/github/app-webhook`);
console.log("[tunnel] Tunnel will close on Ctrl+C.");

const shutdown = async (signal) => {
  console.log(`[tunnel] Caught ${signal}, closing tunnel…`);
  try {
    await listener.close();
  } catch {
    // best-effort; we're exiting anyway
  }
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// keep the event loop alive
process.stdin.resume();

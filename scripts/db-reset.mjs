// Reset both the platform Postgres DB (via prisma migrate reset) and the
// Vikunja SQLite DB (by recreating its Docker volumes). Keep these in lockstep:
// if platform user.id values change, OIDC-provisioned Vikunja users get
// orphaned and the same platform identity ends up mapped to multiple Vikunja
// accounts. Always reset both together.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function run(cmd, args, opts = {}) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...opts,
    });
    child.on("exit", (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`${cmd} ${args.join(" ")} exited with ${code}`));
    });
    child.on("error", rejectP);
  });
}

async function runAllowFail(cmd, args) {
  try {
    await run(cmd, args);
  } catch {
    // Volume may not exist yet; ignore.
  }
}

async function main() {
  console.log("[db-reset] Resetting platform Postgres DB...");
  await run("yarn", [
    "workspace",
    "@internal/db",
    "prisma",
    "migrate",
    "reset",
    "--force",
  ]);

  console.log("[db-reset] Stopping Vikunja container...");
  await runAllowFail("docker", ["compose", "stop", "vikunja"]);
  await runAllowFail("docker", ["compose", "rm", "-f", "vikunja"]);

  console.log("[db-reset] Removing Vikunja volumes...");
  await runAllowFail("docker", [
    "volume",
    "rm",
    "modular-engineering-platform_platform-vikunja-db",
    "modular-engineering-platform_platform-vikunja-files",
  ]);

  console.log("[db-reset] Starting Vikunja with fresh volumes...");
  await run("docker", ["compose", "up", "-d", "vikunja"]);

  console.log("[db-reset] Done. Both DBs reset.");
}

main().catch((err) => {
  console.error("[db-reset] Failed:", err.message);
  process.exit(1);
});

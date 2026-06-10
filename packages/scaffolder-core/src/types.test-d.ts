/** Compile-time assertions for the Capability union. */
import { z } from "zod";
import { defineTemplate } from "./template";
import type { Capability } from "./types";

// ✅ Valid capabilities compile.
const _ok1: Capability = "fs:write";
const _ok2: Capability = "network:external";
const _ok3: Capability = "secrets:read:GITHUB_TOKEN";

// ❌ Typos must fail tsc.
// @ts-expect-error - "fs:wrte" is not a known Capability
const _bad1: Capability = "fs:wrte";

// @ts-expect-error - bare prefix without scope is not allowed
const _bad2: Capability = "secrets:read";

// ✅ Templates compile without visibility metadata.
const _tpl = defineTemplate({
  metadata: {
    id: "ok-tpl",
    version: "1.0.0",
    name: "ok",
    description: "ok",
    audience: ["human"],
    requiredRole: "member",
  },
  parameters: z.object({}),
  capabilities: [],
  plan: () => [],
});

export {};

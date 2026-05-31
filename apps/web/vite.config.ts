// Vite config for apps/web: React plugin, shared env dir, and API dev proxy.
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../../", "");
  const apiPort = Number(env.API_PORT) || 4000;
  const webPort = Number(env.WEB_PORT) || 3010;
  const apiTarget = `http://localhost:${apiPort}`;

  return {
    plugins: [react()],
    envDir: "../../",
    resolve: {
      dedupe: ["react", "react-dom", "react-router-dom"],
    },
    optimizeDeps: {
      include: ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities"],
    },
    server: {
      port: webPort,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
        "/auth": {
          target: apiTarget,
          changeOrigin: true,
        },
        "/oidc": {
          target: apiTarget,
          changeOrigin: true,
        },
        "/.well-known/openid-configuration": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});

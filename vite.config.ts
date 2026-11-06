/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Two ways to reach WordPress:
//  1. proxy (default):   the page asks /wp-json/... on its own address and Vite forwards it to WordPress. No CORS needed.
//  2. cors (--mode cors): the page asks WordPress directly (VITE_WP_BASE in .env.cors). WordPress itself allows it.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.WP_TARGET || "http://localhost:8080";
  return {
    plugins: [react()],
    server: { port: 5173, strictPort: true, proxy: { "/wp-json": { target, changeOrigin: false } } },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});

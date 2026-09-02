import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    // Only unit tests under src/. Without this vitest would also pick up
    // e2e/*.spec.js, which are Playwright tests and use a different runner.
    include: ["src/**/*.test.js"],
    environment: "node",
  },
});

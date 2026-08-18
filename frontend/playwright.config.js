import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests, run locally and in CI only.
 * Never against production: these scenarios create and delete data.
 */
const BASE_URL = "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // shared database: tests must not run into each other
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "html",

  use: {
    baseURL: BASE_URL,
    // Traces only from failed runs. Open one with `npx playwright show-trace`
    // and step through it with DOM snapshots.
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "pl-PL",
    timezoneId: "Europe/Warsaw",
  },

  projects: [
    // Login and the forced password change happen once; the other projects start
    // from the saved session file.
    { name: "setup", testMatch: /auth\.setup\.js/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/admin.json" },
      dependencies: ["setup"],
      // Without this, chromium also picks up the mobile tests, which assume a
      // narrow screen: a project without testMatch matches every file.
      testIgnore: /mobile\.spec\.js/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], storageState: "e2e/.auth/admin.json" },
      dependencies: ["setup"],
      testMatch: /mobile\.spec\.js/,
    },
  ],

  webServer: [
    {
      // A fresh database on every run: the tests delete students and payments,
      // so they must not touch the development database.
      // Deleted via Node, because `rm` does not exist on Windows nor `del` in bash.
      command: [
        `node -e "require('fs').rmSync('e2e.db',{force:true})"`,
        "alembic upgrade head",
        "uvicorn app.main:app --port 8000",
      ].join(" && "),
      cwd: "../backend",
      // url rather than port: Playwright waits for a response from a specific
      // address instead of merely for the port to be taken. Without it the tests
      // start before the server actually answers.
      url: "http://127.0.0.1:8000/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: "sqlite:///./e2e.db",
        JWT_SECRET: "e2e-secret-tylko-do-testow",
        APP_ENV: "dev",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // --host 127.0.0.1 is required: by default Vite binds to "localhost",
      // which on Windows may resolve to IPv6 (::1) first, and a connection to
      // 127.0.0.1 is then refused.
      command: "npm run dev -- --port 5173 --host 127.0.0.1",
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

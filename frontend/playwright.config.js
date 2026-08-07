import { defineConfig, devices } from "@playwright/test";

/**
 * Testy end-to-end uruchamiane wyłącznie lokalnie i w CI.
 * Nigdy przeciwko produkcji — scenariusze tworzą i kasują dane.
 */
const ADRES = "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // wspólna baza — testy nie mogą sobie wchodzić w drogę
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "html",

  use: {
    baseURL: ADRES,
    // Ślady tylko z nieudanych przebiegów — otwierasz je `npx playwright show-trace`
    // i przewijasz krok po kroku ze zrzutami DOM.
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "pl-PL",
    timezoneId: "Europe/Warsaw",
  },

  projects: [
    // Logowanie i wymuszona zmiana hasła wykonują się raz; pozostałe projekty
    // startują z gotową sesją zapisaną do pliku.
    { name: "setup", testMatch: /auth\.setup\.js/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/admin.json" },
      dependencies: ["setup"],
      // Bez tego chromium uruchamia też testy mobilne, które zakładają
      // wąski ekran — projekt bez testMatch łapie wszystkie pliki.
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
      // Świeża baza przy każdym przebiegu — testy kasują uczniów i wpłaty,
      // więc nie mogą dotykać bazy deweloperskiej.
      // Kasowanie przez Node, bo `rm` nie istnieje w Windows, a `del` w bashu.
      command: [
        `node -e "require('fs').rmSync('e2e.db',{force:true})"`,
        "alembic upgrade head",
        "uvicorn app.main:app --port 8000",
      ].join(" && "),
      cwd: "../backend",
      // url zamiast port: Playwright czeka na odpowiedź spod konkretnego
      // adresu, a nie tylko na zajęcie portu. Bez tego test rusza, zanim
      // serwer faktycznie zacznie odpowiadać.
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
      // --host 127.0.0.1 jest konieczne: domyślnie Vite wiąże się z "localhost",
      // które na Windowsie bywa rozwiązywane najpierw na IPv6 (::1) — wtedy
      // połączenie pod 127.0.0.1 jest odrzucane.
      command: "npm run dev -- --port 5173 --host 127.0.0.1",
      url: ADRES,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

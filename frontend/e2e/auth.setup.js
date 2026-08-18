import { test as setup, expect } from "@playwright/test";
import { loginField, passwordField, PASSWORD } from "./helpers";

const SESSION_FILE = "e2e/.auth/admin.json";

/**
 * A fresh database creates an admin/admin account with a forced password change.
 * This step walks that path once and saves the session to a file, so the other
 * tests start already signed in.
 *
 * Note: the session lives in an httponly cookie. Playwright stores cookies in
 * storageState, so this works even though JS cannot see them.
 */
setup("login and forced password change", async ({ page }) => {
  await page.goto("/");

  await loginField(page).fill("admin");
  await passwordField(page).fill("admin");
  await page.getByRole("button", { name: "Zaloguj się" }).click();

  // The backend rejects everything but the password change, so the UI shows
  // only this form: no tabs, no panels.
  await page.getByLabel("Dotychczasowe hasło").fill("admin");
  await page.getByLabel("Nowe hasło", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Powtórz nowe hasło").fill(PASSWORD);
  await page.getByRole("button", { name: "Zapisz hasło" }).click();

  // Once the password is changed the app mounts the real panel.
  await expect(page.getByRole("button", { name: "Kalendarz" })).toBeVisible();

  await page.context().storageState({ path: SESSION_FILE });
});

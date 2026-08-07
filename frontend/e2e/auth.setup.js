import { test as setup, expect } from "@playwright/test";
import { poleLogin, poleHaslo, HASLO } from "./pomocniki";

const PLIK_SESJI = "e2e/.auth/admin.json";

/**
 * Świeża baza tworzy konto admin/admin z wymuszoną zmianą hasła. Ten krok
 * przechodzi tę ścieżkę raz i zapisuje sesję do pliku — pozostałe testy
 * startują już zalogowane.
 *
 * Uwaga: sesja siedzi w ciasteczku httponly. Playwright zapisuje ciasteczka
 * w storageState, więc mechanizm działa mimo że JS ich nie widzi.
 */
setup("logowanie i wymuszona zmiana hasła", async ({ page }) => {
  await page.goto("/");

  await poleLogin(page).fill("admin");
  await poleHaslo(page).fill("admin");
  await page.getByRole("button", { name: "Zaloguj się" }).click();

  // Backend odrzuca wszystko poza zmianą hasła, więc interfejs pokazuje
  // wyłącznie ten formularz — bez zakładek i bez paneli.
  await page.getByLabel("Dotychczasowe hasło").fill("admin");
  await page.getByLabel("Nowe hasło", { exact: true }).fill(HASLO);
  await page.getByLabel("Powtórz nowe hasło").fill(HASLO);
  await page.getByRole("button", { name: "Zapisz hasło" }).click();

  // Po zmianie hasła aplikacja montuje właściwy panel.
  await expect(page.getByRole("button", { name: "Kalendarz" })).toBeVisible();

  await page.context().storageState({ path: PLIK_SESJI });
});

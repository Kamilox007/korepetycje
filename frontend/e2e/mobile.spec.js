import { test, expect } from "@playwright/test";
import { potwierdzenie, dodajUcznia } from "./pomocniki";

/**
 * Uruchamiane w emulacji telefonu (projekt „mobile" w konfiguracji).
 * Sprawdza to, czego nie widać na desktopie: układ z patcha 07 i zachowanie
 * okien przy wysuniętej klawiaturze.
 */
test("nawigacja mieści się na ekranie i przewija w poziomie", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Kalendarz" })).toBeVisible();

  // Strona nie może przewijać się w poziomie. To jest właściwe kryterium —
  // pojedyncze elementy MOGĄ wystawać poza ekran, jeśli siedzą w kontenerze
  // z własnym przewijaniem (jak zakładki w pasku nawigacji).
  const przewijaSieWPoziomie = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(przewijaSieWPoziomie).toBeFalsy();

  // A elementy poza takimi kontenerami wystawać nie mogą.
  const wystajace = await page.evaluate(() => {
    const wKontenerzePrzewijanym = (el) => {
      for (let e = el.parentElement; e; e = e.parentElement) {
        const ov = getComputedStyle(e).overflowX;
        if (ov === "auto" || ov === "scroll") return true;
      }
      return false;
    };
    return [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
      .filter((e) => !wKontenerzePrzewijanym(e))
      .map((e) => e.className || e.tagName)
      .slice(0, 5);
  });
  expect(wystajace).toEqual([]);

  // Pasek nawigacji jest przewijalny, a nie zawinięty do kilku rzędów.
  const pasek = page.locator(".sidebar");
  const przewijalny = await pasek.evaluate((e) => e.scrollWidth > e.clientWidth);
  expect(przewijalny).toBeTruthy();
});

test("okno potwierdzenia jest użyteczne przy wysuniętej klawiaturze", async ({ page }) => {
  await page.goto("/");
  const nazwa = "Halina Mobilna";
  await dodajUcznia(page, nazwa);

  await page
    .getByRole("row", { name: new RegExp(nazwa) })
    .getByRole("button", { name: "Usuń" })
    .click();

  const okno = potwierdzenie(page);
  await okno.getByPlaceholder(nazwa).fill(nazwa);

  // Przycisk musi być widoczny i klikalny mimo pola tekstowego u góry.
  const przycisk = okno.getByRole("button", { name: "Usuń ucznia" });
  await expect(przycisk).toBeInViewport();
  await przycisk.click();
  await expect(page.getByRole("cell", { name: nazwa })).toHaveCount(0);
});

test("tabele przewijają się w poziomie zamiast rozpychać stronę", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Płatności" }).click();

  const szerokoscStrony = await page.evaluate(() => document.body.scrollWidth);
  const szerokoscOkna = await page.evaluate(() => window.innerWidth);
  expect(szerokoscStrony).toBeLessThanOrEqual(szerokoscOkna + 1);
});

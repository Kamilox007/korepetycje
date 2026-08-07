import { test, expect } from "@playwright/test";
import { zakladka, potwierdzenie, dodajUcznia } from "./pomocniki";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Kalendarz" })).toBeVisible();
});

test.describe("potwierdzanie usuwania", () => {
  test("usunięcie ucznia wymaga przepisania nazwiska", async ({ page }) => {
    const nazwa = "Anna Testowa";
    await dodajUcznia(page, nazwa);

    await page
      .getByRole("row", { name: new RegExp(nazwa) })
      .getByRole("button", { name: "Usuń" })
      .click();

    const okno = potwierdzenie(page);
    await expect(okno).toBeVisible();
    await expect(okno).toContainText(nazwa);
    await expect(okno).toContainText("nie da się cofnąć");

    // To jest sedno tej ochrony: kliknięcie „tak" z rozpędu nie wystarcza.
    const przycisk = okno.getByRole("button", { name: "Usuń ucznia" });
    await expect(przycisk).toBeDisabled();

    await okno.getByPlaceholder(nazwa).fill("cokolwiek innego");
    await expect(przycisk).toBeDisabled();

    await okno.getByPlaceholder(nazwa).fill(nazwa);
    await expect(przycisk).toBeEnabled();

    await przycisk.click();
    await expect(page.getByRole("cell", { name: nazwa })).toHaveCount(0);
  });

  test("anulowanie nie usuwa ucznia", async ({ page }) => {
    const nazwa = "Bartek Zostaje";
    await dodajUcznia(page, nazwa);

    await page
      .getByRole("row", { name: new RegExp(nazwa) })
      .getByRole("button", { name: "Usuń" })
      .click();
    await potwierdzenie(page).getByRole("button", { name: "Anuluj" }).click();

    await expect(potwierdzenie(page)).toHaveCount(0);
    await expect(page.getByRole("cell", { name: nazwa })).toBeVisible();
  });

  test("pole potwierdzenia jest czyszczone po anulowaniu", async ({ page }) => {
    const nazwa = "Celina Ponowna";
    await dodajUcznia(page, nazwa);

    const wiersz = page.getByRole("row", { name: new RegExp(nazwa) });
    await wiersz.getByRole("button", { name: "Usuń" }).click();
    await potwierdzenie(page).getByPlaceholder(nazwa).fill(nazwa);
    await potwierdzenie(page).getByRole("button", { name: "Anuluj" }).click();

    await wiersz.getByRole("button", { name: "Usuń" }).click();
    await expect(potwierdzenie(page).getByPlaceholder(nazwa)).toHaveValue("");
    await expect(
      potwierdzenie(page).getByRole("button", { name: "Usuń ucznia" })
    ).toBeDisabled();
  });

  test("kliknięcie w tło anuluje, nie potwierdza", async ({ page }) => {
    const nazwa = "Dawid Tlo";
    await dodajUcznia(page, nazwa);

    await page
      .getByRole("row", { name: new RegExp(nazwa) })
      .getByRole("button", { name: "Usuń" })
      .click();
    // Kliknięcie w róg nakładki, poza samym oknem.
    await potwierdzenie(page).click({ position: { x: 5, y: 5 } });

    await expect(potwierdzenie(page)).toHaveCount(0);
    await expect(page.getByRole("cell", { name: nazwa })).toBeVisible();
  });

  test("usunięcie wpłaty pokazuje kwotę i datę", async ({ page }) => {
    const nazwa = "Ewa Platnik";
    await dodajUcznia(page, nazwa);

    await zakladka(page, "Płatności").click();
    // Przycisk w nagłówku jest zawsze; "Dodaj pierwszą wpłatę" tylko przy pustej liście.
    await page.getByRole("button", { name: "+ Dodaj wpłatę" }).click();
    await page.getByLabel("Za którego ucznia").selectOption({ label: nazwa });
    await page.getByLabel("Kwota (PLN)").fill("123.45");
    await page.getByRole("button", { name: "Zapisz" }).click();

    await page
      .getByRole("row", { name: /123[.,]45/ })
      .getByRole("button", { name: "Usuń" })
      .click();

    const okno = potwierdzenie(page);
    await expect(okno).toContainText("123,45");
    await expect(okno).toContainText("Saldo ucznia zmieni się");

    await okno.getByRole("button", { name: "Usuń wpłatę" }).click();
    await expect(page.getByRole("row", { name: /123[.,]45/ })).toHaveCount(0);
  });

  test("usunięcie przedmiotu ostrzega, że zajęcia zostaną", async ({ page }) => {
    await zakladka(page, "Przedmioty").click();
    const nazwa = "Fizyka testowa";

    // Formularz jest wpisany na stałe w widok, bez otwierania okna.
    await page.getByLabel("Nazwa przedmiotu").fill(nazwa);
    await page.getByRole("button", { name: "Dodaj", exact: true }).click();
    await expect(page.getByRole("cell", { name: nazwa })).toBeVisible();

    await page
      .getByRole("row", { name: new RegExp(nazwa) })
      .getByRole("button", { name: "Usuń" })
      .click();

    const okno = potwierdzenie(page);
    await expect(okno).toContainText("zajęcia zostaną zachowane", { ignoreCase: true });
    await okno.getByRole("button", { name: "Usuń przedmiot" }).click();
    await expect(page.getByRole("cell", { name: nazwa })).toHaveCount(0);
  });
});

test.describe("okna zagnieżdżone", () => {
  test("potwierdzenie usunięcia zajęć leży NAD oknem edycji", async ({ page }) => {
    const nazwa = "Grzegorz Zajecia";
    await dodajUcznia(page, nazwa);

    // Zajęcia jednorazowe dodane z poziomu kalendarza.
    await zakladka(page, "Kalendarz").click();
    await page.getByRole("button", { name: "+ Zajęcia jednorazowe" }).click();
    await page.getByLabel("Uczeń").selectOption({ label: nazwa });
    await page.getByRole("button", { name: "Dodaj", exact: true }).click();

    // Otwarcie edycji, a z niej — usuwanie. Zajęcia trafiają na dziś,
    // więc są widoczne w domyślnym widoku.
    await page.getByText(nazwa, { exact: false }).last().click();
    const edycja = page.locator(".overlay:not(.overlay-confirm)");
    await expect(edycja).toBeVisible();

    await edycja.getByRole("button", { name: "Usuń", exact: true }).click();

    const okno = potwierdzenie(page);
    await expect(okno).toBeVisible();
    await expect(okno).toContainText("oznacz je jako odwołane");

    // Oba okna otwarte naraz — potwierdzenie musi być na wierzchu.
    await expect(edycja).toBeVisible();
    const zConfirm = await okno.evaluate((e) => getComputedStyle(e).zIndex);
    const zEdycja = await edycja.evaluate((e) => getComputedStyle(e).zIndex);
    expect(Number(zConfirm)).toBeGreaterThan(Number(zEdycja) || 0);

    // Anulowanie wraca do edycji, nie zamyka obu naraz.
    await okno.getByRole("button", { name: "Anuluj" }).click();
    await expect(okno).toHaveCount(0);
    await expect(edycja).toBeVisible();
  });
});

test.describe("wylogowanie", () => {
  test("kasuje sesję po stronie serwera", async ({ page }) => {
    await page.getByRole("button", { name: "Wyloguj" }).click();
    await expect(page.getByRole("button", { name: "Zaloguj się" })).toBeVisible();

    // Odświeżenie nie przywraca sesji — ciasteczko zostało skasowane
    // przez backend, a nie tylko wyczyszczone w pamięci przeglądarki.
    await page.reload();
    await expect(page.getByRole("button", { name: "Zaloguj się" })).toBeVisible();
  });
});

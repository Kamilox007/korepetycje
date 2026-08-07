// Wspólne lokatory. Etykiety są powiązane z kontrolkami przez htmlFor/id,
// więc chwytamy pola po widocznym tekście — tak jak robi to użytkownik
// i czytnik ekranu. Zmiana układu HTML nie psuje wtedy testów.

export const HASLO = "TestoweHaslo123";

export function poleLogin(page) {
  return page.getByLabel("Login", { exact: true });
}

export function poleHaslo(page) {
  return page.getByLabel("Hasło", { exact: true });
}

export async function zaloguj(page, login = "admin", haslo = HASLO) {
  await page.goto("/");
  await poleLogin(page).fill(login);
  await poleHaslo(page).fill(haslo);
  await page.getByRole("button", { name: "Zaloguj się" }).click();
}

export function zakladka(page, nazwa) {
  return page.getByRole("button", { name: nazwa, exact: true });
}

/** Okno potwierdzenia — to, które dodaliśmy zamiast natywnego confirm(). */
export function potwierdzenie(page) {
  return page.locator(".overlay-confirm");
}

/** Dodaje ucznia przez interfejs i zwraca jego nazwę. */
export async function dodajUcznia(page, nazwa, cena = "80") {
  await zakladka(page, "Uczniowie").click();
  await page.getByRole("button", { name: "+ Uczeń" }).click();
  await page.getByPlaceholder("np. Jessika Kowalska").fill(nazwa);
  await page.getByRole("button", { name: "Dodaj", exact: true }).click();
  await page.getByRole("cell", { name: nazwa }).waitFor();
  return nazwa;
}

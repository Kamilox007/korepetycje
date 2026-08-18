// Shared locators. Labels are tied to their controls via htmlFor/id, so fields
// are matched by visible text, the way a user and a screen reader would. Changing
// the HTML layout then does not break the tests.

export const PASSWORD = "TestPassword123";

export function loginField(page) {
  return page.getByLabel("Login", { exact: true });
}

export function passwordField(page) {
  return page.getByLabel("Hasło", { exact: true });
}

export async function login(page, username = "admin", password = PASSWORD) {
  await page.goto("/");
  await loginField(page).fill(username);
  await passwordField(page).fill(password);
  await page.getByRole("button", { name: "Zaloguj się" }).click();
}

/** Sidebar navigation. These are links now, not buttons: the app uses real
 *  routes so the back button and bookmarks work. */
export function tab(page, name) {
  return page.getByRole("link", { name, exact: true });
}

/** The confirmation dialog we added in place of the native confirm(). */
export function confirmDialog(page) {
  return page.locator(".overlay-confirm");
}

/** Add a student through the UI and return their name. */
export async function addStudent(page, name, price = "80") {
  await tab(page, "Uczniowie").click();
  await page.getByRole("button", { name: "+ Uczeń" }).click();
  await page.getByLabel("Imię i nazwisko").fill(name);
  await page.getByRole("button", { name: "Dodaj", exact: true }).click();
  await page.getByRole("cell", { name }).waitFor();
  return name;
}

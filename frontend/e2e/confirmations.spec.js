import { test, expect } from "@playwright/test";
import { tab, confirmDialog, addStudent, login } from "./helpers";

/** Every block but the logout one starts from the shared signed-in session. */
async function openApp(page) {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Kalendarz" })).toBeVisible();
}

test.describe("deletion confirmations", () => {
  test.beforeEach(async ({ page }) => openApp(page));
  test("archiving a student keeps their history and can be undone", async ({ page }) => {
    const name = "Anna Test";
    await addStudent(page, name);

    await page
      .getByRole("row", { name: new RegExp(name) })
      .getByRole("button", { name: "Archiwizuj" })
      .click();

    const dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(name);
    // The wording has to say what actually happens: nothing is destroyed here.
    await expect(dialog).toContainText("zostaje zachowana");

    await dialog.getByRole("button", { name: "Archiwizuj" }).click();
    await expect(page.getByRole("cell", { name })).toHaveCount(0);

    // The student is recoverable, which is the entire reason for archiving.
    await page.getByRole("button", { name: /Archiwum \(\d+\)/ }).click();
    await expect(page.getByRole("cell", { name })).toBeVisible();
    await page.getByRole("button", { name: "Przywróć" }).first().click();
    await expect(page.getByRole("cell", { name })).toBeVisible();
  });

  test("permanent deletion requires retyping the name", async ({ page }) => {
    const name = "Bea Purge";
    await addStudent(page, name);

    await page
      .getByRole("row", { name: new RegExp(name) })
      .getByRole("button", { name: "Archiwizuj" })
      .click();
    await confirmDialog(page).getByRole("button", { name: "Archiwizuj" }).click();

    await page.getByRole("button", { name: /Archiwum \(\d+\)/ }).click();
    await page
      .getByRole("row", { name: new RegExp(name) })
      .getByRole("button", { name: "Usuń trwale" })
      .click();

    const dialog = confirmDialog(page);
    await expect(dialog).toContainText("nie da się cofnąć");

    // This is the point of the guard: clicking "yes" on autopilot is not enough.
    const button = dialog.getByRole("button", { name: "Usuń trwale" });
    await expect(button).toBeDisabled();

    await dialog.getByPlaceholder(name).fill("something else");
    await expect(button).toBeDisabled();

    await dialog.getByPlaceholder(name).fill(name);
    await expect(button).toBeEnabled();

    await button.click();
    await expect(page.getByRole("cell", { name })).toHaveCount(0);
  });

  test("cancelling does not archive the student", async ({ page }) => {
    const name = "Bart Stays";
    await addStudent(page, name);

    await page
      .getByRole("row", { name: new RegExp(name) })
      .getByRole("button", { name: "Archiwizuj" })
      .click();
    await confirmDialog(page).getByRole("button", { name: "Anuluj" }).click();

    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(page.getByRole("cell", { name })).toBeVisible();
  });

  test("the confirmation field is cleared after cancelling", async ({ page }) => {
    const name = "Celia Again";
    await addStudent(page, name);

    const row = page.getByRole("row", { name: new RegExp(name) });
    await row.getByRole("button", { name: "Archiwizuj" }).click();
    await confirmDialog(page).getByRole("button", { name: "Archiwizuj" }).click();
    await page.getByRole("button", { name: /Archiwum \(\d+\)/ }).click();
    const arch = page.getByRole("row", { name: new RegExp(name) });
    await arch.getByRole("button", { name: "Usuń trwale" }).click();
    await confirmDialog(page).getByPlaceholder(name).fill(name);
    await confirmDialog(page).getByRole("button", { name: "Anuluj" }).click();

    await arch.getByRole("button", { name: "Usuń trwale" }).click();
    await expect(confirmDialog(page).getByPlaceholder(name)).toHaveValue("");
    await expect(
      confirmDialog(page).getByRole("button", { name: "Usuń trwale" })
    ).toBeDisabled();
  });

  test("clicking the backdrop cancels rather than confirms", async ({ page }) => {
    const name = "David Backdrop";
    await addStudent(page, name);

    await page
      .getByRole("row", { name: new RegExp(name) })
      .getByRole("button", { name: "Archiwizuj" })
      .click();
    // Click the corner of the overlay, outside the dialog itself.
    await confirmDialog(page).click({ position: { x: 5, y: 5 } });

    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(page.getByRole("cell", { name })).toBeVisible();
  });

  test("deleting a payment shows the amount and date", async ({ page }) => {
    const name = "Eve Payer";
    await addStudent(page, name);

    await tab(page, "Płatności").click();
    // The header button is always there; "Dodaj pierwszą wpłatę" only when empty.
    await page.getByRole("button", { name: "+ Dodaj wpłatę" }).click();
    await page.getByLabel("Za którego ucznia").selectOption({ label: name });
    await page.getByLabel("Kwota (PLN)").fill("123.45");
    await page.getByRole("button", { name: "Zapisz" }).click();

    await page
      .getByRole("row", { name: /123[.,]45/ })
      .getByRole("button", { name: "Usuń" })
      .click();

    const dialog = confirmDialog(page);
    await expect(dialog).toContainText("123,45");
    await expect(dialog).toContainText("Saldo ucznia zmieni się");

    await dialog.getByRole("button", { name: "Usuń wpłatę" }).click();
    await expect(page.getByRole("row", { name: /123[.,]45/ })).toHaveCount(0);
  });

  test("deleting a subject warns that lessons are kept", async ({ page }) => {
    await tab(page, "Przedmioty").click();
    const name = "Test Subject";

    // The form is part of the view; no dialog to open.
    await page.getByLabel("Nazwa przedmiotu").fill(name);
    await page.getByRole("button", { name: "Dodaj", exact: true }).click();
    await expect(page.getByRole("cell", { name })).toBeVisible();

    await page
      .getByRole("row", { name: new RegExp(name) })
      .getByRole("button", { name: "Usuń" })
      .click();

    const dialog = confirmDialog(page);
    await expect(dialog).toContainText("zajęcia zostaną zachowane", { ignoreCase: true });
    await dialog.getByRole("button", { name: "Usuń przedmiot" }).click();
    await expect(page.getByRole("cell", { name })).toHaveCount(0);
  });
});

test.describe("nested dialogs", () => {
  test.beforeEach(async ({ page }) => openApp(page));
  test("the lesson delete confirmation sits ABOVE the editor dialog", async ({ page }) => {
    const name = "Greg Lesson";
    await addStudent(page, name);

    // A one-off lesson added from the calendar.
    await tab(page, "Kalendarz").click();
    await page.getByRole("button", { name: "+ Zajęcia jednorazowe" }).click();
    await page.getByLabel("Uczeń").selectOption({ label: name });
    await page.getByRole("button", { name: "Dodaj", exact: true }).click();

    // Open the editor, then delete from it. The lesson lands on today, so it is
    // visible in the default view.
    await page.getByText(name, { exact: false }).last().click();
    const editor = page.locator(".overlay:not(.overlay-confirm)");
    await expect(editor).toBeVisible();

    await editor.getByRole("button", { name: "Usuń", exact: true }).click();

    const dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("oznacz je jako odwołane");

    // Both dialogs are open at once: the confirmation must be on top.
    await expect(editor).toBeVisible();
    const zConfirm = await dialog.evaluate((e) => getComputedStyle(e).zIndex);
    const zEditor = await editor.evaluate((e) => getComputedStyle(e).zIndex);
    expect(Number(zConfirm)).toBeGreaterThan(Number(zEditor) || 0);

    // Cancelling returns to the editor rather than closing both.
    await dialog.getByRole("button", { name: "Anuluj" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(editor).toBeVisible();
  });
});

test.describe("dialog dismissal", () => {
  test.beforeEach(async ({ page }) => openApp(page));
  test("selecting text and releasing outside does not close the dialog", async ({ page }) => {
    // A click fires on the common ancestor of press and release, so dragging a
    // selection out of a field used to register as a backdrop click and throw
    // away everything typed.
    await page.goto("/");
    await tab(page, "Uczniowie").click();
    await page.getByRole("button", { name: "+ Uczeń" }).click();

    const field = page.getByLabel("Imię i nazwisko");
    await field.fill("Drag Select");

    const box = await field.boundingBox();
    await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 400, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator(".modal")).toBeVisible();
    await expect(field).toHaveValue("Drag Select");
  });

  test("a genuine backdrop click still closes it", async ({ page }) => {
    await page.goto("/");
    await tab(page, "Uczniowie").click();
    await page.getByRole("button", { name: "+ Uczeń" }).click();
    await expect(page.locator(".modal")).toBeVisible();

    await page.locator(".overlay").click({ position: { x: 5, y: 5 } });
    await expect(page.locator(".modal")).toHaveCount(0);
  });

  test("Escape closes it", async ({ page }) => {
    await page.goto("/");
    await tab(page, "Uczniowie").click();
    await page.getByRole("button", { name: "+ Uczeń" }).click();
    await expect(page.locator(".modal")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".modal")).toHaveCount(0);
  });
});

test.describe("logout", () => {
  // Starts signed out on purpose. Logging out revokes the session row in the
  // database, so reusing the shared storageState here would kill it for every
  // test that runs afterwards.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("clears the session server-side", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("link", { name: "Kalendarz" })).toBeVisible();

    await page.getByRole("button", { name: "Wyloguj" }).click();
    await expect(page.getByRole("button", { name: "Zaloguj się" })).toBeVisible();

    // A reload does not restore the session: the cookie was cleared by the
    // backend, not merely dropped from browser memory.
    await page.reload();
    await expect(page.getByRole("button", { name: "Zaloguj się" })).toBeVisible();
  });
});

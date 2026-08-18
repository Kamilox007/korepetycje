import { test, expect } from "@playwright/test";
import { tab, confirmDialog, addStudent } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Kalendarz" })).toBeVisible();
});

test.describe("deletion confirmations", () => {
  test("deleting a student requires retyping the name", async ({ page }) => {
    const name = "Anna Test";
    await addStudent(page, name);

    await page
      .getByRole("row", { name: new RegExp(name) })
      .getByRole("button", { name: "Usuń" })
      .click();

    const dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(name);
    await expect(dialog).toContainText("nie da się cofnąć");

    // This is the point of the guard: clicking "yes" on autopilot is not enough.
    const button = dialog.getByRole("button", { name: "Usuń ucznia" });
    await expect(button).toBeDisabled();

    await dialog.getByPlaceholder(name).fill("something else");
    await expect(button).toBeDisabled();

    await dialog.getByPlaceholder(name).fill(name);
    await expect(button).toBeEnabled();

    await button.click();
    await expect(page.getByRole("cell", { name })).toHaveCount(0);
  });

  test("cancelling does not delete the student", async ({ page }) => {
    const name = "Bart Stays";
    await addStudent(page, name);

    await page
      .getByRole("row", { name: new RegExp(name) })
      .getByRole("button", { name: "Usuń" })
      .click();
    await confirmDialog(page).getByRole("button", { name: "Anuluj" }).click();

    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(page.getByRole("cell", { name })).toBeVisible();
  });

  test("the confirmation field is cleared after cancelling", async ({ page }) => {
    const name = "Celia Again";
    await addStudent(page, name);

    const row = page.getByRole("row", { name: new RegExp(name) });
    await row.getByRole("button", { name: "Usuń" }).click();
    await confirmDialog(page).getByPlaceholder(name).fill(name);
    await confirmDialog(page).getByRole("button", { name: "Anuluj" }).click();

    await row.getByRole("button", { name: "Usuń" }).click();
    await expect(confirmDialog(page).getByPlaceholder(name)).toHaveValue("");
    await expect(
      confirmDialog(page).getByRole("button", { name: "Usuń ucznia" })
    ).toBeDisabled();
  });

  test("clicking the backdrop cancels rather than confirms", async ({ page }) => {
    const name = "David Backdrop";
    await addStudent(page, name);

    await page
      .getByRole("row", { name: new RegExp(name) })
      .getByRole("button", { name: "Usuń" })
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

test.describe("logout", () => {
  test("clears the session server-side", async ({ page }) => {
    await page.getByRole("button", { name: "Wyloguj" }).click();
    await expect(page.getByRole("button", { name: "Zaloguj się" })).toBeVisible();

    // A reload does not restore the session: the cookie was cleared by the
    // backend, not merely dropped from browser memory.
    await page.reload();
    await expect(page.getByRole("button", { name: "Zaloguj się" })).toBeVisible();
  });
});

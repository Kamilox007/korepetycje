import { test, expect } from "@playwright/test";
import { tab } from "./helpers";

/**
 * Navigation lives in the URL now. What matters is that the browser's own
 * controls work: back, forward, reload and a pasted address.
 */

test("each tab has its own address", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/kalendarz$/);

  await tab(page, "Uczniowie").click();
  await expect(page).toHaveURL(/\/uczniowie$/);

  await tab(page, "Płatności").click();
  await expect(page).toHaveURL(/\/platnosci$/);
});

test("the back button returns to the previous tab", async ({ page }) => {
  await page.goto("/");
  await tab(page, "Uczniowie").click();
  await tab(page, "Podsumowanie").click();

  await page.goBack();
  await expect(page).toHaveURL(/\/uczniowie$/);
  await expect(page.getByRole("heading", { name: "Uczniowie" })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/\/podsumowanie$/);
});

test("a pasted address opens that view directly", async ({ page }) => {
  await page.goto("/przedmioty");
  await expect(page.getByRole("heading", { name: "Przedmioty" })).toBeVisible();
});

test("reloading keeps you where you were", async ({ page }) => {
  await page.goto("/platnosci");
  await page.reload();
  await expect(page).toHaveURL(/\/platnosci$/);
  await expect(page.getByRole("heading", { name: "Płatności" })).toBeVisible();
});

test("an unknown address falls back to the calendar", async ({ page }) => {
  await page.goto("/nie-ma-takiej-strony");
  await expect(page).toHaveURL(/\/kalendarz$/);
});

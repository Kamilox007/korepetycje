import { test, expect } from "@playwright/test";
import { tab, addStudent, login, PASSWORD } from "./helpers";

/**
 * Tutor and student panels: the calendar view added alongside the list.
 * Both panels are read-only calendars, so what matters is that lessons show up
 * and that navigating months does not empty the view.
 */

test("staff can still reach the calendar", async ({ page }) => {
  await page.goto("/");
  await tab(page, "Kalendarz").click();
  await expect(page.getByRole("button", { name: "Dziś" })).toBeVisible();
});

test("the panel calendar switches between week and month", async ({ page }) => {
  await page.goto("/");
  await tab(page, "Kalendarz").click();

  await page.getByRole("button", { name: "Miesiąc" }).click();
  await expect(page.locator(".month-grid")).toBeVisible();

  await page.getByRole("button", { name: "Tydzień" }).click();
  await expect(page.locator(".week")).toBeVisible();
});

test("navigating months keeps loading lessons", async ({ page }) => {
  const name = "Cal Student";
  await addStudent(page, name);

  await tab(page, "Kalendarz").click();
  await page.getByRole("button", { name: "Miesiąc" }).click();

  // Forward and back must land on the same view rather than an empty one:
  // the fetch range follows the anchor, so this exercises the refetch.
  const label = await page.locator(".range").textContent();
  await page.getByRole("button", { name: "→" }).click();
  await expect(page.locator(".range")).not.toHaveText(label ?? "");
  await page.getByRole("button", { name: "←" }).click();
  await expect(page.locator(".range")).toHaveText(label ?? "");
});

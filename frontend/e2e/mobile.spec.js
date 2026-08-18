import { test, expect } from "@playwright/test";
import { confirmDialog, addStudent } from "./helpers";

/**
 * Runs under phone emulation (the "mobile" project in the config). Covers what
 * a desktop run cannot see: the layout from patch 07 and how dialogs behave with
 * the on-screen keyboard open.
 */
test("navigation fits the screen and scrolls horizontally", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Kalendarz" })).toBeVisible();

  // The page itself must not scroll horizontally. That is the right criterion:
  // individual elements MAY extend past the viewport when they sit in a container
  // with its own scrolling, such as the tabs in the navigation bar.
  const scrollsHorizontally = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(scrollsHorizontally).toBeFalsy();

  // Elements outside such containers must not overflow.
  const overflowing = await page.evaluate(() => {
    const insideScrollContainer = (el) => {
      for (let e = el.parentElement; e; e = e.parentElement) {
        const ov = getComputedStyle(e).overflowX;
        if (ov === "auto" || ov === "scroll") return true;
      }
      return false;
    };
    return [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
      .filter((e) => !insideScrollContainer(e))
      .map((e) => e.className || e.tagName)
      .slice(0, 5);
  });
  expect(overflowing).toEqual([]);

  // The navigation bar scrolls rather than wrapping onto several rows.
  const navbar = page.locator(".sidebar");
  const scrollable = await navbar.evaluate((e) => e.scrollWidth > e.clientWidth);
  expect(scrollable).toBeTruthy();
});

test("the confirmation dialog stays usable with the keyboard open", async ({ page }) => {
  await page.goto("/");
  const name = "Helen Mobile";
  await addStudent(page, name);

  await page
    .getByRole("row", { name: new RegExp(name) })
    .getByRole("button", { name: "Usuń" })
    .click();

  const dialog = confirmDialog(page);
  await dialog.getByPlaceholder(name).fill(name);

  // The button must remain visible and clickable despite the text field above.
  const button = dialog.getByRole("button", { name: "Usuń ucznia" });
  await expect(button).toBeInViewport();
  await button.click();
  await expect(page.getByRole("cell", { name })).toHaveCount(0);
});

test("tables scroll horizontally instead of stretching the page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Płatności" }).click();

  const pageWidth = await page.evaluate(() => document.body.scrollWidth);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  expect(pageWidth).toBeLessThanOrEqual(viewportWidth + 1);
});

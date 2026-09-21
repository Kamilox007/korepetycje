import { test, expect } from "@playwright/test";
import { tab, confirmDialog } from "./helpers";

/**
 * Tablica: link bez konta, dwie przeglądarki naraz, undo, rotacja linku.
 *
 * Płótno Excalidrawa to <canvas>, więc stan sceny czytamy i wstawiamy przez
 * window.__tablicaAPI, które PageEditor wystawia tylko na dev serwerze.
 */

function rect(id, extra = {}) {
  return {
    id, type: "rectangle", x: 100, y: 100, width: 120, height: 80, angle: 0,
    strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
    strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [],
    frameId: null, index: "a0", roundness: null, seed: 1, version: 1, versionNonce: 1,
    isDeleted: false, boundElements: null, updated: Date.now(), link: null, locked: false,
    ...extra,
  };
}

async function waitForBoard(page) {
  await page.waitForFunction(() => Boolean(window.__tablicaAPI));
  await expect(page.locator(".tablica-status")).toHaveText("na żywo", { timeout: 15_000 });
}

/** Wstawia element tak, jakby narysował go użytkownik (trafia do historii undo). */
async function draw(page, element) {
  await page.evaluate((el) => {
    const a = window.__tablicaAPI;
    a.updateScene({
      elements: [...a.getSceneElementsIncludingDeleted(), el],
      captureUpdate: "IMMEDIATELY",
    });
  }, element);
}

async function erase(page, id) {
  await page.evaluate((id) => {
    const a = window.__tablicaAPI;
    const els = a.getSceneElementsIncludingDeleted().map((e) =>
      e.id === id ? { ...e, isDeleted: true, version: e.version + 1, versionNonce: e.versionNonce + 1 } : e);
    a.updateScene({ elements: els, captureUpdate: "IMMEDIATELY" });
  }, id);
}

const visibleIds = (page) => page.evaluate(() => window.__tablicaAPI.getSceneElements().map((e) => e.id));

/** Kontekst bez ciasteczka sesji. browser.newContext() dziedziczy storageState
 *  z konfiguracji projektu (admin), więc trzeba go jawnie wyzerować. */
const guestContext = (browser) => browser.newContext({ storageState: { cookies: [], origins: [] } });

async function createBoard(page, title) {
  const res = await page.request.post("/api/boards", { data: { title } });
  expect(res.ok()).toBeTruthy();
  const board = await res.json();
  return { id: board.id, path: board.path, token: board.path.replace("/t/", "") };
}

test.describe("tablica", () => {
  test("gość otwiera link bez konta: brak nawigacji panelu i narzędzi właściciela", async ({ page, browser }) => {
    const { path } = await createBoard(page, "Gość E2E");

    const guestCtx = await guestContext(browser);
    const guest = await guestCtx.newPage();
    await guest.goto(path);

    // Pierwsze wejście: pytanie o imię do etykiety przy kursorze.
    await expect(guest.getByRole("heading", { name: "Jak masz na imię?" })).toBeVisible();
    await guest.getByLabel("Imię").fill("Kasia");
    await guest.getByRole("button", { name: "Gotowe" }).click();

    await waitForBoard(guest);
    await expect(guest.locator(".tablica-title")).toHaveText("Gość E2E");
    await expect(guest.getByRole("link", { name: "Kalendarz" })).toHaveCount(0);
    await expect(guest.getByRole("link", { name: "Panel" })).toHaveCount(0);
    await expect(guest.getByRole("button", { name: "Nowa strona" })).toHaveCount(0);
    await expect(guest.getByRole("button", { name: "Kasia" })).toBeVisible();

    // Odświeżenie: imię zapamiętane, bez ponownego pytania.
    await guest.reload();
    await waitForBoard(guest);
    await expect(guest.getByRole("heading", { name: "Jak masz na imię?" })).toHaveCount(0);

    // Właściciel z ciasteczkiem widzi swoje narzędzia.
    await page.goto(path);
    await waitForBoard(page);
    await expect(page.getByRole("link", { name: "Panel" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nowa strona" })).toBeVisible();
    await guestCtx.close();
  });

  test("narysowane zostaje po odświeżeniu", async ({ page }) => {
    const { path } = await createBoard(page, "Trwałość E2E");
    await page.goto(path);
    await waitForBoard(page);
    await draw(page, rect("trwaly"));
    await expect.poll(() => visibleIds(page)).toContain("trwaly");

    await page.reload();
    await waitForBoard(page);
    await expect.poll(() => visibleIds(page)).toContain("trwaly");
  });

  test("dwie przeglądarki naraz: element pojawia się u drugiej, usunięcie nie wraca", async ({ page, browser }) => {
    const { path } = await createBoard(page, "Dwoje E2E");
    const guestCtx = await guestContext(browser);
    const guest = await guestCtx.newPage();

    await page.goto(path);
    await waitForBoard(page);
    await guest.goto(path);
    await guest.getByRole("button", { name: "Gotowe" }).click();
    await waitForBoard(guest);

    // Oboje widzą się na pasku.
    await expect(page.locator(".tablica-peer")).toHaveCount(1);
    await expect(guest.locator(".tablica-peer")).toHaveCount(1);

    await draw(guest, rect("od-goscia", { seed: 2 }));
    await expect.poll(() => visibleIds(page), { timeout: 10_000 }).toContain("od-goscia");

    await draw(page, rect("od-wlasciciela", { index: "a1", seed: 3 }));
    await expect.poll(() => visibleIds(guest), { timeout: 10_000 }).toContain("od-wlasciciela");

    // Usunięcie u właściciela znika u gościa i nie wraca po chwili.
    await erase(page, "od-goscia");
    await expect.poll(() => visibleIds(guest), { timeout: 10_000 }).not.toContain("od-goscia");
    await page.waitForTimeout(1500);
    expect(await visibleIds(guest)).not.toContain("od-goscia");
    expect(await visibleIds(page)).not.toContain("od-goscia");

    // Po wyjściu ostatniej osoby stan ląduje w bazie.
    await guestCtx.close();
    await page.close();
    const fresh = await guestContext(browser);
    const check = await fresh.newPage();
    await check.goto(path);
    await check.getByRole("button", { name: "Gotowe" }).click();
    await waitForBoard(check);
    const ids = await visibleIds(check);
    expect(ids).toContain("od-wlasciciela");
    expect(ids).not.toContain("od-goscia");
    await fresh.close();
  });

  test("obrazek wklejony przez jedną osobę pojawia się u drugiej, która już jest na tablicy", async ({ page, browser }) => {
    const { path } = await createBoard(page, "Obrazek E2E");
    const guestCtx = await guestContext(browser);
    const guest = await guestCtx.newPage();
    await page.goto(path);
    await waitForBoard(page);
    await guest.goto(path);
    await guest.getByRole("button", { name: "Gotowe" }).click();
    await waitForBoard(guest);

    // 1x1 PNG. Właściciel "wkleja": plik do Excalidrawa + element obrazka,
    // dokładnie tak, jak robi to sam edytor po Ctrl+V.
    const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const fileId = "e2e-plik-obrazka-0001";
    await page.evaluate(({ fileId, PNG_1PX }) => {
      const a = window.__tablicaAPI;
      a.addFiles([{ id: fileId, dataURL: "data:image/png;base64," + PNG_1PX, mimeType: "image/png", created: Date.now() }]);
      a.updateScene({
        elements: [...a.getSceneElementsIncludingDeleted(), {
          id: "obrazek-1", type: "image", fileId, status: "saved", scale: [1, 1],
          x: 50, y: 50, width: 100, height: 100, angle: 0, strokeColor: "transparent",
          backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid",
          roughness: 0, opacity: 100, groupIds: [], frameId: null, index: "a0", roundness: null,
          seed: 9, version: 1, versionNonce: 1, isDeleted: false, boundElements: null,
          updated: Date.now(), link: null, locked: false, crop: null,
        }],
        captureUpdate: "IMMEDIATELY",
      });
    }, { fileId, PNG_1PX });

    // Element dociera po WS, a bajty gość dociąga sam z serwera.
    await expect.poll(() => visibleIds(guest), { timeout: 15_000 }).toContain("obrazek-1");
    await expect.poll(
      () => guest.evaluate((id) => Boolean(window.__tablicaAPI.getFiles()[id]), fileId),
      { timeout: 15_000 },
    ).toBe(true);
    const mime = await guest.evaluate((id) => window.__tablicaAPI.getFiles()[id].mimeType, fileId);
    expect(mime).toBe("image/png");
    await guestCtx.close();
  });

  test("eksport całej tablicy do PDF: jedna strona tablicy = jedna strona PDF", async ({ page }) => {
    const { path, token } = await createBoard(page, "PDF E2E");
    await page.goto(path);
    await waitForBoard(page);
    await draw(page, rect("do-pdf"));
    await page.getByRole("button", { name: "Nowa strona" }).click();
    await expect(page.locator(".tablica-page")).toHaveCount(3);

    // Bez pobierania (Playwright nie ma gdzie zapisać): moduł zwraca Blob.
    const info = await page.evaluate(async ({ token }) => {
      const { exportBoardPdf } = await import("/src/tablica/pdf.js");
      const board = await fetch(`/api/t/${token}`).then((r) => r.json());
      const blob = await exportBoardPdf({ token, title: board.title, pages: board.pages, save: false });
      const head = new TextDecoder().decode(new Uint8Array(await blob.slice(0, 5).arrayBuffer()));
      const text = await blob.text();
      return { size: blob.size, type: blob.type, head, pages: (text.match(/\/Type\s*\/Page[^s]/g) || []).length };
    }, { token });
    expect(info.type).toBe("application/pdf");
    expect(info.head).toBe("%PDF-");
    expect(info.pages).toBe(2);
    expect(info.size).toBeGreaterThan(1000);
    expect(info.size).toBeLessThan(2_000_000);
  });

  test("kółko myszy nad płótnem przybliża, z Shift/Alt przesuwa", async ({ page }) => {
    const { path } = await createBoard(page, "Zoom E2E");
    await page.goto(path);
    await waitForBoard(page);
    const view = () => page.evaluate(() => {
      const s = window.__tablicaAPI.getAppState();
      return { zoom: s.zoom.value, x: s.scrollX, y: s.scrollY };
    });
    const canvas = page.locator(".excalidraw__canvas.interactive");
    await canvas.hover();
    const start = await view();

    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await view()).zoom).toBeGreaterThan(start.zoom);
    await page.mouse.wheel(0, 300);
    await expect.poll(async () => (await view()).zoom).toBeLessThan(start.zoom + 0.001);

    const beforePan = await view();
    await page.keyboard.down("Alt");
    await page.mouse.wheel(0, 200);
    await page.keyboard.up("Alt");
    await expect.poll(async () => (await view()).y).not.toBe(beforePan.y);
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 200);
    await page.keyboard.up("Shift");
    await expect.poll(async () => (await view()).x).not.toBe(beforePan.x);
    expect((await view()).zoom).toBe(beforePan.zoom);
  });

  test("Ctrl+Z nie cofa cudzej pracy", async ({ page, browser }) => {
    const { path } = await createBoard(page, "Undo E2E");
    const guestCtx = await guestContext(browser);
    const guest = await guestCtx.newPage();
    await page.goto(path);
    await waitForBoard(page);
    await guest.goto(path);
    await guest.getByRole("button", { name: "Gotowe" }).click();
    await waitForBoard(guest);

    // Właściciel rysuje swoje (wchodzi do jego historii), potem gość swoje.
    await draw(page, rect("moje", { seed: 4 }));
    await expect.poll(() => visibleIds(guest), { timeout: 10_000 }).toContain("moje");
    await draw(guest, rect("cudze", { index: "a1", seed: 5 }));
    await expect.poll(() => visibleIds(page), { timeout: 10_000 }).toContain("cudze");

    // Ctrl+Z u właściciela: cofa "moje" (ostatnie WŁASNE), "cudze" zostaje.
    await page.locator(".excalidraw__canvas.interactive").first().click({ position: { x: 400, y: 300 } });
    await page.keyboard.press("Control+z");
    await expect.poll(() => visibleIds(page), { timeout: 10_000 }).not.toContain("moje");
    expect(await visibleIds(page)).toContain("cudze");
    await expect.poll(() => visibleIds(guest), { timeout: 10_000 }).not.toContain("moje");
    expect(await visibleIds(guest)).toContain("cudze");
    await guestCtx.close();
  });

  test("właściciel dodaje stronę, gość ją widzi i może przełączyć", async ({ page, browser }) => {
    const { path } = await createBoard(page, "Strony E2E");
    await page.goto(path);
    await waitForBoard(page);
    await page.getByRole("button", { name: "Nowa strona" }).click();
    await expect(page.locator(".tablica-page")).toHaveCount(3); // 2 strony + "+"

    const guestCtx = await guestContext(browser);
    const guest = await guestCtx.newPage();
    await guest.goto(path);
    await guest.getByRole("button", { name: "Gotowe" }).click();
    await waitForBoard(guest);
    const pages = guest.locator(".tablica-page");
    await expect(pages).toHaveCount(2);
    await pages.nth(1).click();
    await expect(pages.nth(1)).toHaveClass(/active/);
    await waitForBoard(guest);
    await guestCtx.close();
  });

  test("rotacja linku w panelu unieważnia stary link", async ({ page, browser }) => {
    const { path } = await createBoard(page, "Rotacja E2E");
    const guestCtx = await guestContext(browser);
    const guest = await guestCtx.newPage();
    await guest.goto(path);
    await guest.getByRole("button", { name: "Gotowe" }).click();
    await waitForBoard(guest);

    await page.goto("/tablice");
    await page.getByRole("row", { name: /Rotacja E2E/ }).getByRole("button", { name: "Nowy link" }).click();
    const dialog = confirmDialog(page);
    await expect(dialog).toContainText("przestanie działać natychmiast");
    await dialog.getByRole("button", { name: "Nowy link" }).click();
    const newLink = await page.getByLabel("Link").inputValue();
    expect(newLink).not.toContain(path);

    // Gość podłączony na stary link zostaje rozłączony (4404) i od razu
    // widzi, że tablica zniknęła - bez odświeżania.
    await expect(guest.getByRole("heading", { name: "Ta tablica nie jest dostępna" })).toBeVisible({ timeout: 10_000 });
    // Stary link po odświeżeniu też nie działa.
    await guest.goto(path);
    await expect(guest.getByRole("heading", { name: "Ta tablica nie jest dostępna" })).toBeVisible();
    await guest.goto(new URL(newLink).pathname);
    await guest.getByRole("button", { name: "Gotowe" }).click();
    await waitForBoard(guest);
    await guestCtx.close();
  });

  test("lista tablic: archiwizacja i przywrócenie", async ({ page }) => {
    await createBoard(page, "Archiwum E2E");
    await page.goto("/");
    await tab(page, "Tablice").click();
    await page.getByRole("row", { name: /Archiwum E2E/ }).getByRole("button", { name: "Archiwizuj" }).click();
    await confirmDialog(page).getByRole("button", { name: "Archiwizuj" }).click();
    await expect(page.getByRole("row", { name: /Archiwum E2E/ })).toHaveCount(0);
    await page.getByRole("button", { name: /Archiwum \(\d+\)/ }).click();
    await page.getByRole("row", { name: /Archiwum E2E/ }).getByRole("button", { name: "Przywróć" }).click();
    await expect(page.getByRole("row", { name: /Archiwum E2E/ }).getByRole("button", { name: "Kopiuj link" })).toBeVisible();
  });
});

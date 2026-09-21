/**
 * Eksport całej tablicy do PDF: jedna strona tablicy = jedna strona PDF.
 *
 * Każda strona jest renderowana przez Excalidraw do PNG (exportToBlob, jasny
 * motyw, białe tło, niezależnie od motywu na ekranie) i wklejana do
 * dokumentu jsPDF, dopasowana do A4 z marginesem. Tytuł strony jest
 * rysowany jako element tekstowy w scenie, nie przez jsPDF - wbudowane
 * czcionki jsPDF nie mają polskich znaków, a Excalifont ma.
 *
 * jsPDF ładuje się dopiero przy pierwszym eksporcie (osobny chunk).
 */
import { exportToBlob } from "@excalidraw/excalidraw";
import { api } from "../api";
import { fetchFileData } from "./sync";

const MAX_PX = 2400;        // dłuższy bok renderu; więcej nie poprawia PDF-a, tylko go tuczy
const MARGIN_MM = 10;

function bbox(elements) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of elements) {
    minX = Math.min(minX, e.x); minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x + (e.width || 0)); maxY = Math.max(maxY, e.y + (e.height || 0));
  }
  return { minX, minY, maxX, maxY };
}

function titleElement(text, x, y) {
  return {
    id: "pdf-tytul", type: "text", x, y, width: text.length * 12, height: 25,
    text, originalText: text, fontSize: 20, fontFamily: 5, textAlign: "left", verticalAlign: "top",
    lineHeight: 1.25, autoResize: true, containerId: null,
    strokeColor: "#1e1e1e", backgroundColor: "transparent", roughness: 0,
    version: 1, versionNonce: 1, seed: 1, isDeleted: false, angle: 0, opacity: 100,
    groupIds: [], frameId: null, roundness: null, locked: false, link: null, boundElements: null,
    strokeWidth: 1, strokeStyle: "solid", fillStyle: "solid", updated: 0, index: "Zz",
  };
}

const blobToDataURL = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

/**
 * @param {object} o
 * @param {string} o.token
 * @param {string} o.title  tytuł tablicy (nazwa pliku)
 * @param {{id:number, title:string}[]} o.pages
 * @param {(done:number, total:number) => void} [o.onProgress]
 * @param {boolean} [o.save=true]  false: zwróć Blob zamiast uruchamiać pobieranie (testy)
 */
export async function exportBoardPdf({ token, title, pages, onProgress, save = true }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  let first = true;

  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i, pages.length);
    const page = await api.boardPage(token, pages[i].id);
    const elements = page.elements.filter((e) => !e.isDeleted);
    const imageIds = [...new Set(elements.filter((e) => e.type === "image" && e.fileId).map((e) => e.fileId))];
    const files = {};
    for (const id of imageIds) {
      const f = await fetchFileData(token, id);
      if (f) files[id] = f;
    }

    const { minX, minY } = elements.length ? bbox(elements) : { minX: 0, minY: 0 };
    const label = `${title} — ${pages[i].title}`;
    const scene = [titleElement(label, minX, minY - 50), ...elements];

    const blob = await exportToBlob({
      elements: scene, files,
      appState: { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false },
      mimeType: "image/png", exportPadding: 24,
      getDimensions: (w, h) => {
        const s = Math.min(2, MAX_PX / Math.max(w, h, 1));
        return { width: Math.round(w * s), height: Math.round(h * s), scale: s };
      },
    });
    const dataUrl = await blobToDataURL(blob);
    const dims = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.width, h: img.height });
      img.src = dataUrl;
    });

    // Orientacja strony PDF pod kształt rysunku, obraz wpasowany z marginesem.
    const landscape = dims.w >= dims.h;
    if (!first) doc.addPage("a4", landscape ? "landscape" : "portrait");
    else if (!landscape) { doc.deletePage(1); doc.addPage("a4", "portrait"); }
    first = false;
    const pw = doc.internal.pageSize.getWidth() - 2 * MARGIN_MM;
    const ph = doc.internal.pageSize.getHeight() - 2 * MARGIN_MM;
    const k = Math.min(pw / dims.w, ph / dims.h);
    const w = dims.w * k, h = dims.h * k;
    // "FAST" = deflate; bez tego jsPDF wkłada PNG jako surowe piksele i dwie
    // strony ważą 17 MB. Rysunek kreskowy na białym kompresuje się ~50×.
    doc.addImage(dataUrl, "PNG", MARGIN_MM + (pw - w) / 2, MARGIN_MM + (ph - h) / 2, w, h, undefined, "FAST");
  }
  onProgress?.(pages.length, pages.length);

  const safe = title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "tablica";
  if (!save) return doc.output("blob");
  doc.save(`${safe}.pdf`);
  return null;
}

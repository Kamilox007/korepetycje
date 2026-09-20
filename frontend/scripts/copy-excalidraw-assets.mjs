// Kopiuje fonty Excalidrawa z paczki do public/excalidraw/, żeby edytor nie
// pobierał ich z CDN (unpkg). Uruchamiane przed `dev` i `build` (package.json).
// Katalog docelowy jest w .gitignore - to artefakt, nie źródło.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "node_modules", "@excalidraw", "excalidraw", "dist", "prod", "fonts");
const dst = join(root, "public", "excalidraw", "fonts");

if (!existsSync(src)) {
  console.error("Brak node_modules/@excalidraw/excalidraw - uruchom npm install.");
  process.exit(1);
}
rmSync(dst, { recursive: true, force: true });
mkdirSync(dirname(dst), { recursive: true });
cpSync(src, dst, { recursive: true });
console.log("Excalidraw: fonty skopiowane do public/excalidraw/fonts");

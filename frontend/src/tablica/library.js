/**
 * Biblioteka kształtów tablicy.
 *
 * Dwie części:
 *  - wbudowane bryły (rzut ukośny, niewidoczne krawędzie przerywane) -
 *    dostarczane z aplikacją, te same na każdej tablicy, u każdego;
 *    w panelu Biblioteka siedzą w sekcji „opublikowane";
 *  - dodatki użytkownika („dodaj do biblioteki") - wspólne dla wszystkich
 *    tablic: na koncie (zalogowani) albo w localStorage (gość). Excalidraw
 *    sam niczego nie zapisuje: oddaje listę w onLibraryChange, a my ją
 *    odkładamy.
 *
 * Elementy są minimalne: Excalidraw uzupełnia brakujące pola przy wczytaniu
 * biblioteki (restoreLibraryItems), więc nie trzeba powtarzać całej
 * struktury elementu.
 */

import { api } from "../api";

const STORAGE_KEY = "tablica:biblioteka";
const BUILTIN_PREFIX = "wbudowane-";

let seq = 0;
const nextId = (item) => `${BUILTIN_PREFIX}${item}-${++seq}`;
// Excalidraw uznaje pozycję biblioteki za tę samą po id ORAZ versionNonce
// elementów; bez stałego nonce restore losuje nowy przy każdym wczytaniu
// i bryły mnożą się z każdym otwarciem strony.
const fixed = () => ({ version: 1, versionNonce: 100000 + seq, seed: 200000 + seq, isDeleted: false });

/** Łamana przez podane punkty; przerywana = krawędź niewidoczna. */
function line(item, points, { dashed = false, smooth = false } = {}) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return {
    id: nextId(item), type: "line",
    x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y,
    points: points.map(([px, py]) => [px - x, py - y]),
    strokeStyle: dashed ? "dashed" : "solid",
    strokeWidth: 1.5, roughness: 0,
    roundness: smooth ? { type: 2 } : null,
    strokeColor: "#1e1e1e", backgroundColor: "transparent",
    ...fixed(),
  };
}

function ellipse(item, x, y, width, height, { dashed = false } = {}) {
  return {
    id: nextId(item), type: "ellipse", x, y, width, height,
    strokeStyle: dashed ? "dashed" : "solid", strokeWidth: 1.5, roughness: 0,
    strokeColor: "#1e1e1e", backgroundColor: "transparent",
    ...fixed(),
  };
}

/** Punkty połówki elipsy o środku (cx, cy); `front` = dolna (bliższa) połowa. */
function halfEllipse(cx, cy, rx, ry, front, n = 14) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = Math.PI * (i / n);
    const a = front ? t : Math.PI + t;   // 0..π = dolna połowa (y rośnie w dół)
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

/** Zamknięty wielokąt (ostatni punkt = pierwszy). */
const poly = (item, pts, opts) => line(item, [...pts, pts[0]], opts);

function cuboid(name, w, h, dx, dy) {
  // przód: A(0,h) B(w,h) C(w,0) D(0,0); tył przesunięty o (dx,-dy)
  const A = [0, h + dy], B = [w, h + dy], C = [w, dy], D = [0, dy];
  const A2 = [dx, h], B2 = [w + dx, h], C2 = [w + dx, 0], D2 = [dx, 0];
  return [
    poly(name, [A, B, C, D]),                 // ściana przednia
    line(name, [D, D2, C2, C]),               // górna ściana (tylne krawędzie górne)
    line(name, [B, B2, C2]),                  // prawa ściana
    line(name, [A, A2], { dashed: true }),    // krawędzie od tylnego dolnego lewego wierzchołka
    line(name, [A2, B2], { dashed: true }),
    line(name, [A2, D2], { dashed: true }),
  ];
}

function triangularPrism(name) {
  // podstawa: A(0,140) B(110,140) C(150,105) - C z tyłu po prawej; wysokość 100
  const h = 100;
  const A = [0, 140], B = [110, 140], C = [150, 105];
  const A2 = [0, 140 - h], B2 = [110, 140 - h], C2 = [150, 105 - h];
  return [
    line(name, [A, B, C]),                    // AB, BC widoczne
    line(name, [C, A], { dashed: true }),     // AC za bryłą
    poly(name, [A2, B2, C2]),                 // górna podstawa
    line(name, [A, A2]), line(name, [B, B2]), line(name, [C, C2]),
  ];
}

function squarePyramid(name) {
  const A = [0, 140], B = [120, 140], C = [170, 105], D = [50, 105], S = [85, 0];
  return [
    line(name, [A, B, C]),
    line(name, [C, D], { dashed: true }),
    line(name, [D, A], { dashed: true }),
    line(name, [A, S]), line(name, [B, S]), line(name, [C, S]),
    line(name, [D, S], { dashed: true }),
  ];
}

function tetrahedron(name) {
  const A = [0, 140], B = [100, 140], C = [150, 110], S = [60, 0];
  return [
    line(name, [A, B, C]),
    line(name, [C, A], { dashed: true }),
    line(name, [A, S]), line(name, [B, S]), line(name, [C, S]),
  ];
}

function cylinder(name) {
  const rx = 55, ry = 16, h = 120, cx = rx, top = ry, bottom = ry + h;
  return [
    ellipse(name, 0, 0, 2 * rx, 2 * ry),                                  // górna podstawa w całości
    line(name, halfEllipse(cx, bottom, rx, ry, true), { smooth: true }),   // dolna: przód
    line(name, halfEllipse(cx, bottom, rx, ry, false), { smooth: true, dashed: true }), // dolna: tył
    line(name, [[0, top], [0, bottom]]),
    line(name, [[2 * rx, top], [2 * rx, bottom]]),
  ];
}

function cone(name) {
  const rx = 60, ry = 18, h = 140, cx = rx, base = h;
  return [
    line(name, halfEllipse(cx, base, rx, ry, true), { smooth: true }),
    line(name, halfEllipse(cx, base, rx, ry, false), { smooth: true, dashed: true }),
    line(name, [[0, base], [cx, 0]]),
    line(name, [[2 * rx, base], [cx, 0]]),
  ];
}

function sphere(name) {
  const r = 60;
  return [
    ellipse(name, 0, 0, 2 * r, 2 * r),
    line(name, halfEllipse(r, r, r, r * 0.32, true), { smooth: true }),
    line(name, halfEllipse(r, r, r, r * 0.32, false), { smooth: true, dashed: true }),
  ];
}

const BUILTIN_SHAPES = [
  ["Prostopadłościan", () => cuboid("prostopadloscian", 130, 80, 50, 35)],
  ["Sześcian", () => cuboid("szescian", 90, 90, 40, 30)],
  ["Graniastosłup trójkątny", () => triangularPrism("graniastoslup")],
  ["Ostrosłup czworokątny", () => squarePyramid("ostroslup")],
  ["Ostrosłup trójkątny (czworościan)", () => tetrahedron("czworoscian")],
  ["Walec", () => cylinder("walec")],
  ["Stożek", () => cone("stozek")],
  ["Kula", () => sphere("kula")],
];

// Stałe id i data: Excalidraw rozpoznaje po nich, że to te same pozycje, więc
// nie mnożą się przy każdym wczytaniu.
// Kolejność rysowania (fractional index) też musi być ustalona: element bez
// `index` dostaje go przy wczytaniu przez mutateElement, co losuje nowy
// versionNonce - i dedupe znowu nie działa.
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const withIndices = (elements) => elements.map((e, i) => ({ ...e, index: `a${BASE62[i]}` }));

export const BUILTIN_LIBRARY = BUILTIN_SHAPES.map(([name, build], i) => ({
  id: `${BUILTIN_PREFIX}${i}`,
  status: "published",
  name,
  created: 1_700_000_000_000 + i,
  elements: withIndices(build()),
}));

export const isBuiltin = (item) => typeof item.id === "string" && item.id.startsWith(BUILTIN_PREFIX);

/**
 * Skąd brać i dokąd zapisywać dodatki użytkownika.
 *
 * Zalogowany (korepetytor, staff): na koncie, przez API - ta sama biblioteka
 * na każdym urządzeniu i w backupie bazy. Gość: localStorage tej
 * przeglądarki. Rozstrzyga pierwsze GET: 401/403 znaczy „gość".
 */
export async function openLibraryStore() {
  try {
    const { items } = await api.myBoardLibrary();
    return {
      kind: "konto",
      items: items.filter((i) => i && !isBuiltin(i)),
      save: (all) => api.saveMyBoardLibrary(all.filter((i) => !isBuiltin(i))),
    };
  } catch {
    return {
      kind: "przegladarka",
      items: loadLocal(),
      save: async (all) => saveLocal(all),
    };
  }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const items = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? items.filter((i) => i && !isBuiltin(i)) : [];
  } catch {
    return [];
  }
}

function saveLocal(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.filter((i) => !isBuiltin(i))));
  } catch { /* prywatne okno, pełny magazyn - trudno */ }
}

/** Z onLibraryChange: zapis nie częściej niż co sekundę, ostatni stan wygrywa. */
export function makeLibrarySaver(store, onError) {
  let timer = null, pending = null;
  return (items) => {
    pending = items;
    if (timer) return;
    timer = setTimeout(async () => {
      timer = null;
      try { await store.save(pending); }
      catch (e) { onError?.("Nie udało się zapisać biblioteki: " + e.message); }
    }, 1000);
  };
}

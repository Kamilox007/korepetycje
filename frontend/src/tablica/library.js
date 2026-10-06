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


/** Strzałka po punktach; `both` = grot na obu końcach. */
function arrow(item, points, { both = false, dashed = false } = {}) {
  return {
    ...line(item, points, { dashed }),
    type: "arrow",
    startArrowhead: both ? "arrow" : null,
    endArrowhead: "arrow",
    elbowed: false,
  };
}

/** Krótki tekst (etykieta osi, wierzchołka, wzoru). Wymiary szacunkowe -
 *  Excalidraw i tak renderuje po fontSize, a przy wczytaniu biblioteki
 *  nie mierzy tekstu na nowo. */
function text(item, x, y, str, size = 16) {
  const width = Math.round(str.length * size * 0.6), height = Math.round(size * 1.25);
  return {
    id: nextId(item), type: "text", x, y, width, height,
    text: str, originalText: str, fontSize: size, fontFamily: 5,
    textAlign: "left", verticalAlign: "top", lineHeight: 1.25, autoResize: true, containerId: null,
    strokeColor: "#1e1e1e", backgroundColor: "transparent", roughness: 0,
    ...fixed(),
  };
}

/** Punkty na krzywej y = f(x) dla x w [x0, x1] (współrzędne ekranu, y w dół). */
function curve(f, x0, x1, n = 40) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    pts.push([x, f(x)]);
  }
  return pts;
}

// ---------------------------------------------------------------- matematyka

function axes(name, { size = 240, step = 20, labels = true } = {}) {
  const c = size / 2, out = [];
  out.push(arrow(name, [[0, c], [size, c]]));          // oś x
  out.push(arrow(name, [[c, size], [c, 0]]));          // oś y
  for (let v = step; v < c; v += step) {               // podziałka
    for (const d of [-v, v]) {
      out.push(line(name, [[c + d, c - 4], [c + d, c + 4]]));
      out.push(line(name, [[c - 4, c + d], [c + 4, c + d]]));
    }
  }
  if (labels) {
    out.push(text(name, size - 10, c + 6, "x"));
    out.push(text(name, c + 8, -2, "y"));
    out.push(text(name, c - 14, c + 4, "0", 14));
  }
  return out;
}

function numberLine(name) {
  const w = 260, y = 20, out = [arrow(name, [[0, y], [w, y]], { both: true })];
  for (let i = 0; i <= 6; i++) {
    const x = 30 + i * 33.3;
    out.push(line(name, [[x, y - 5], [x, y + 5]]));
    out.push(text(name, x - 6, y + 8, String(i - 3), 13));
  }
  return out;
}

function unitCircle(name) {
  const c = 120, r = 85, a = Math.PI / 6;   // punkt pod kątem 30°
  const px = c + r * Math.cos(a), py = c - r * Math.sin(a);
  const arc = [];
  for (let i = 0; i <= 8; i++) {
    const t = (a * i) / 8;
    arc.push([c + 28 * Math.cos(t), c - 28 * Math.sin(t)]);
  }
  return [
    arrow(name, [[0, c], [2 * c, c]]),
    arrow(name, [[c, 2 * c], [c, 0]]),
    ellipse(name, c - r, c - r, 2 * r, 2 * r),
    line(name, [[c, c], [px, py]]),
    line(name, [[px, py], [px, c]], { dashed: true }),
    line(name, [[px, py], [c, py]], { dashed: true }),
    line(name, arc, { smooth: true }),
    ellipse(name, px - 4, py - 4, 8, 8),
    text(name, c + 34, c - 22, "α", 14),
    text(name, c + r + 4, c + 4, "1", 13),
    text(name, c - 12, c - r - 20, "1", 13),
  ];
}

function rightTriangle(name) {
  const A = [0, 150], B = [200, 150], C = [0, 0], m = 16;
  return [
    poly(name, [A, B, C]),
    line(name, [[m, 150], [m, 150 - m], [0, 150 - m]]),     // znak kąta prostego
    text(name, 92, 156, "a"), text(name, -20, 66, "b"), text(name, 104, 56, "c"),
  ];
}

function anyTriangle(name) {
  const A = [0, 160], B = [220, 160], C = [70, 0];
  return [
    poly(name, [A, B, C]),
    text(name, -6, 166, "A"), text(name, 216, 166, "B"), text(name, 62, -24, "C"),
    text(name, 22, 132, "α", 14), text(name, 178, 132, "β", 14), text(name, 64, 14, "γ", 14),
  ];
}

function angle(name) {
  const O = [0, 120], a = Math.PI / 5, len = 180;
  const arc = [];
  for (let i = 0; i <= 8; i++) {
    const t = (a * i) / 8;
    arc.push([O[0] + 40 * Math.cos(t), O[1] - 40 * Math.sin(t)]);
  }
  return [
    line(name, [[O[0] + len, O[1]], O, [O[0] + len * Math.cos(a), O[1] - len * Math.sin(a)]]),
    line(name, arc, { smooth: true }),
    text(name, 48, 92, "α", 14),
  ];
}

function parabola(name) {
  const size = 240, c = size / 2;
  return [
    ...axes(name, { size, labels: false }),
    line(name, curve((x) => c - ((x - c) * (x - c)) / 60, c - 100, c + 100), { smooth: true }),
    text(name, size - 10, c + 6, "x"), text(name, c + 8, -2, "y"),
  ];
}

function sine(name) {
  const w = 300, h = 140, cy = h / 2;
  return [
    arrow(name, [[0, cy], [w, cy]]),
    arrow(name, [[20, h], [20, 0]]),
    line(name, curve((x) => cy - 50 * Math.sin(((x - 20) / 260) * 2 * Math.PI), 20, w - 10, 60), { smooth: true }),
    text(name, w - 10, cy + 4, "x"), text(name, 26, -2, "y"),
    text(name, 140, cy + 6, "π", 13), text(name, 268, cy + 6, "2π", 13),
  ];
}

// ---------------------------------------------------------------- chemia

function hexagon(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const t = Math.PI / 6 + (i * Math.PI) / 3;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return pts;
}

function benzene(name) {
  const r = 50;
  return [poly(name, hexagon(r, r, r)), ellipse(name, r - 30, r - 30, 60, 60)];
}

function cyclohexane(name) {
  const r = 50;
  return [poly(name, hexagon(r, r, r))];
}

function zigzag(name) {
  const pts = [];
  for (let i = 0; i < 6; i++) pts.push([i * 40, i % 2 ? 0 : 30]);
  return [line(name, pts)];
}

function bonds(name) {
  const out = [];
  [[0, 1], [50, 2], [100, 3]].forEach(([y, n]) => {
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * 6;
      out.push(line(name, [[0, y + off], [90, y + off]]));
    }
  });
  return out;
}

function reactionArrow(name) {
  return [arrow(name, [[0, 20], [140, 20]])];
}

function equilibrium(name) {
  // dwie strzałki w przeciwne strony, jak ⇌
  return [
    arrow(name, [[0, 14], [140, 14]]),
    arrow(name, [[140, 30], [0, 30]]),
  ];
}

function water(name) {
  const O = [80, 50], H1 = [20, 100], H2 = [140, 100];
  // wiązanie od brzegu do brzegu kółek, nie przez ich środki
  const bond = (P, rp, Q, rq) => {
    const dx = Q[0] - P[0], dy = Q[1] - P[1], d = Math.hypot(dx, dy);
    return line(name, [[P[0] + (dx / d) * rp, P[1] + (dy / d) * rp], [Q[0] - (dx / d) * rq, Q[1] - (dy / d) * rq]]);
  };
  return [
    bond(O, 22, H1, 15), bond(O, 22, H2, 15),
    ellipse(name, O[0] - 22, O[1] - 22, 44, 44),
    ellipse(name, H1[0] - 15, H1[1] - 15, 30, 30),
    ellipse(name, H2[0] - 15, H2[1] - 15, 30, 30),
    text(name, O[0] - 8, O[1] - 11, "O", 18),
    text(name, H1[0] - 6, H1[1] - 9, "H", 15),
    text(name, H2[0] - 6, H2[1] - 9, "H", 15),
  ];
}

function orbitals(name) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const x = i * 44;
    out.push(poly(name, [[x, 0], [x + 36, 0], [x + 36, 36], [x, 36]]));
  }
  out.push(arrow(name, [[10, 30], [10, 6]]), arrow(name, [[26, 6], [26, 30]]));   // ↑↓
  out.push(arrow(name, [[54, 30], [54, 6]]));                                     // ↑
  return out;
}

function testTube(name) {
  const w = 40, h = 150;
  const bottom = [];
  for (let i = 0; i <= 10; i++) {
    const t = Math.PI * (i / 10);
    bottom.push([w / 2 + (w / 2) * Math.cos(t), h - 20 + (w / 2) * Math.sin(t)]);
  }
  return [
    line(name, [[0, 0], [0, h - 20]]),
    line(name, [[w, 0], [w, h - 20]]),
    line(name, bottom.reverse(), { smooth: true }),
    line(name, [[-4, 0], [w + 4, 0]]),
    line(name, [[0, 90], [w, 90]], { dashed: true }),   // poziom cieczy
  ];
}

function beaker(name) {
  const w = 100, h = 110;
  return [
    line(name, [[6, 0], [0, 0], [0, h], [w, h], [w, 0], [w - 6, 0]]),
    line(name, [[0, 70], [w, 70]], { dashed: true }),
    line(name, [[w - 20, 25], [w - 8, 25]]), line(name, [[w - 20, 45], [w - 8, 45]]),
  ];
}

function flask(name) {
  const w = 110, h = 130;
  return [
    line(name, [[40, 0], [40, 35], [0, h], [w, h], [w - 40, 35], [w - 40, 0]]),
    line(name, [[38, 0], [w - 38, 0]]),
    line(name, [[18, 100], [w - 18, 100]], { dashed: true }),
  ];
}

const BUILTIN_SHAPES = [
  // --- bryły ---
  ["Prostopadłościan", () => cuboid("prostopadloscian", 130, 80, 50, 35)],
  ["Sześcian", () => cuboid("szescian", 90, 90, 40, 30)],
  ["Graniastosłup trójkątny", () => triangularPrism("graniastoslup")],
  ["Ostrosłup czworokątny", () => squarePyramid("ostroslup")],
  ["Ostrosłup trójkątny (czworościan)", () => tetrahedron("czworoscian")],
  ["Walec", () => cylinder("walec")],
  ["Stożek", () => cone("stozek")],
  ["Kula", () => sphere("kula")],
  // --- matematyka ---
  ["Układ współrzędnych", () => axes("uklad")],
  ["Oś liczbowa", () => numberLine("os")],
  ["Okrąg trygonometryczny", () => unitCircle("okrag")],
  ["Trójkąt prostokątny (a, b, c)", () => rightTriangle("prostokatny")],
  ["Trójkąt z kątami (α, β, γ)", () => anyTriangle("trojkat")],
  ["Kąt α", () => angle("kat")],
  ["Parabola na osiach", () => parabola("parabola")],
  ["Sinusoida", () => sine("sinus")],
  // --- chemia ---
  ["Pierścień benzenowy", () => benzene("benzen")],
  ["Cykloheksan", () => cyclohexane("cykloheksan")],
  ["Łańcuch węglowy (zygzak)", () => zigzag("zygzak")],
  ["Wiązania: pojedyncze, podwójne, potrójne", () => bonds("wiazania")],
  ["Strzałka reakcji", () => reactionArrow("reakcja")],
  ["Strzałki równowagi", () => equilibrium("rownowaga")],
  ["Cząsteczka wody", () => water("woda")],
  ["Klatki orbitalne", () => orbitals("orbitale")],
  ["Probówka", () => testTube("probowka")],
  ["Zlewka", () => beaker("zlewka")],
  ["Kolba stożkowa", () => flask("kolba")],
];

// Stałe id i data: Excalidraw rozpoznaje po nich, że to te same pozycje, więc
// nie mnożą się przy każdym wczytaniu.
// Kolejność rysowania (fractional index) też musi być ustalona: element bez
// `index` dostaje go przy wczytaniu przez mutateElement, co losuje nowy
// versionNonce - i dedupe znowu nie działa.
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
// "a0".."az" dla pierwszych 62 elementów, potem "b00".."bzz" - rosnąco
// w porządku leksykograficznym, jak wymaga fractional indexing.
const fracIndex = (i) => (i < 62 ? `a${BASE62[i]}` : `b${BASE62[Math.floor(i / 62)]}${BASE62[i % 62]}`);
const withIndices = (elements) => elements.map((e, i) => ({ ...e, index: fracIndex(i) }));

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

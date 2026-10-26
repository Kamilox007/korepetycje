/**
 * Naprawa końcówek kresek odręcznych.
 *
 * Część urządzeń (tablety, telefony) przy oderwaniu rysika albo dotknięciu
 * ekranu zgłasza skrajny punkt kreski w złym miejscu - zwykle tam, gdzie
 * kreska się zaczęła. Excalidraw dokłada go jak każdy inny, więc dochodzi
 * odcinek, który domyka kształt: ręcznie pisana „3" zamienia się w „B".
 * Na produkcji było takich kresek kilkaset, u jednych osób stale, u innych
 * wcale - zależnie od sprzętu.
 *
 * Usuwamy skrajny punkt tylko wtedy, gdy spełnia OBA warunki:
 *  - odcinek do niego jest wielokrotnie dłuższy od typowego w tej kresce
 *    i stanowi sporą część jej rozmiaru (to jest skok, nie drżenie ręki),
 *  - kreska zawraca na nim pod ostrym kątem.
 * Szybki ruch na końcu kreski też daje długi ostatni odcinek, ale idzie
 * dalej w tę samą stronę - takiego nie ruszamy, bo to zamierzony fragment.
 *
 * Moduł jest czysty (bez Excalidrawa i DOM), testowany w kreski.test.js.
 */

const ILE_RAZY_DLUZSZY = 8;      // od mediany odcinków tej kreski
const CZESC_ROZMIARU = 0.25;     // od większego wymiaru kreski bez skoku
const KAT_ZAWROTU = 100;         // stopnie: 0 = prosto dalej, 180 = zawrót

const odl = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function mediana(liczby) {
  const s = [...liczby].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Kąt zwrotu w punkcie b przy przejściu a -> b -> c, w stopniach. */
function katZwrotu(a, b, c) {
  const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]];
  const n1 = Math.hypot(...v1), n2 = Math.hypot(...v2);
  if (!n1 || !n2) return 0;
  const cos = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Czy punkt `skok` (doklejony za `b`, przed którym był `a`) jest fałszywy?
 * `reszta` to punkty kreski bez niego - z nich liczymy typowy odcinek
 * i rozmiar, żeby sam skok ich nie zawyżał.
 */
function czySkok(a, b, skok, reszta) {
  const odcinki = [];
  for (let i = 0; i < reszta.length - 1; i++) odcinki.push(odl(reszta[i], reszta[i + 1]));
  const typowy = mediana(odcinki) || 0.1;
  const xs = reszta.map((p) => p[0]), ys = reszta.map((p) => p[1]);
  const rozmiar = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  const dlugosc = odl(b, skok);
  return dlugosc > ILE_RAZY_DLUZSZY * typowy
    && dlugosc > CZESC_ROZMIARU * rozmiar
    && katZwrotu(a, b, skok) > KAT_ZAWROTU;
}

/**
 * Punkty kreski bez fałszywych skrajnych punktów, albo null, gdy nie ma
 * czego poprawiać. Punkty są względne do początku elementu (pierwszy to
 * [0, 0]); gdy odpada pierwszy, zwracamy też przesunięcie elementu.
 */
export function poprawKoncowki(points) {
  // Za krótka kreska (kropka, przecinek) nie ma „typowego odcinka".
  if (!Array.isArray(points) || points.length < 6) return null;
  let pts = points;
  let zKonca = 0, zPoczatku = 0;       // ile punktów odpadło z każdej strony

  // Fałszywy punkt bywa zgłoszony kilka razy w tym samym miejscu (ostatni
  // ruch i oderwanie rysika) - wtedy ostatni odcinek ma długość zero i skoku
  // nie widać. Sprawdzamy więc pierwszy punkt z takiej serii powtórzeń.
  let k = pts.length - 1;
  while (k > 0 && odl(pts[k], pts[k - 1]) < 0.5) k--;
  if (k >= 4 && czySkok(pts[k - 2], pts[k - 1], pts[k], pts.slice(0, k))) {
    zKonca = pts.length - k;
    pts = pts.slice(0, k);
  }
  // Na początku to samo, czytane od drugiej strony kreski.
  let j = 0;
  while (j < pts.length - 1 && odl(pts[j], pts[j + 1]) < 0.5) j++;
  if (pts.length - j >= 5 && czySkok(pts[j + 2], pts[j + 1], pts[j], pts.slice(j + 1))) {
    zPoczatku = j + 1;
    pts = pts.slice(j + 1);
  }
  if (!zKonca && !zPoczatku) return null;

  const [ox, oy] = pts[0];
  const wzgledne = pts.map(([x, y]) => [x - ox, y - oy]);
  const xs = wzgledne.map((p) => p[0]), ys = wzgledne.map((p) => p[1]);
  return {
    points: wzgledne,
    dx: ox, dy: oy,                 // o tyle przesuwa się x/y elementu
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    zPoczatku, zKonca,
    usunietyPoczatek: zPoczatku > 0, usunietyKoniec: zKonca > 0,
  };
}

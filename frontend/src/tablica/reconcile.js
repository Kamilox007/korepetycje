/**
 * Scalanie elementów Excalidrawa po stronie klienta.
 *
 * Ta sama reguła co w backend/app/boards_reconcile.py - celowo zduplikowana:
 * serwer rozstrzyga konflikty między klientami, klient scala przychodzące
 * zmiany ze swoim stanem, który może zawierać edycje jeszcze niewysłane.
 * Reguła: wygrywa wyższy `version`, remis rozstrzyga NIŻSZY `versionNonce`
 * (dokładnie jak `shouldDiscardRemoteElement` w paczce Excalidrawa 0.18).
 *
 * Paczka eksportuje własne `reconcileElements`, ale ciągnie za sobą DOM,
 * więc nie da się go uruchomić w Vitest (environment: node). Ten moduł jest
 * czysty i testowany; dodatkowo odwzorowuje jedyną rzecz, którą wersja
 * z paczki robi ponad regułę wersji: nie nadpisuje elementu, który
 * użytkownik właśnie edytuje (`protectIds`).
 *
 * Elementy `isDeleted` zostają - usunięcie w Excalidrawie to flaga
 * z podbitą wersją, a nie brak elementu.
 */

export function versionKey(el) {
  return `${el.version ?? 0}:${el.versionNonce ?? 0}`;
}

/** Czy `incoming` ma zastąpić `current`? Brak `current` = tak. */
export function wins(incoming, current) {
  if (!current) return true;
  const iv = incoming.version ?? 0, cv = current.version ?? 0;
  if (iv !== cv) return iv > cv;
  return (incoming.versionNonce ?? 0) < (current.versionNonce ?? 0);
}

/**
 * Czy `index` da się sparsować jako fractional index Excalidrawa?
 *
 * Pierwszy znak mówi, ile cyfr ma część całkowita ("a" - jedna, "b" - dwie,
 * i lustrzanie dla "Z".."A"), więc "b9" czy "d1" są za krótkie i Excalidraw
 * rzuca na nich "invalid order key" - w środku obsługi wskaźnika, przez co
 * nikt nie może rysować. Bliźniak `valid_order_key` w boards_reconcile.py.
 */
export function validOrderKey(index) {
  if (typeof index !== "string" || !index) return false;
  const g = index[0];
  let potrzeba;
  if (g >= "a" && g <= "z") potrzeba = g.charCodeAt(0) - 97 + 2;
  else if (g >= "A" && g <= "Z") potrzeba = 90 - g.charCodeAt(0) + 2;
  else return false;
  if (index.length < potrzeba) return false;
  return /^[0-9A-Za-z]+$/.test(index);
}

/** Usuwa niemożliwy do sparsowania `index`; Excalidraw wygeneruje nowy. */
export function sanitizeIndex(el) {
  if (!("index" in el) || validOrderKey(el.index)) return el;
  const { index, ...reszta } = el;
  return reszta;
}

/** Kolejność rysowania: po `index` (fractional indexing), remis po id. */
export function orderByIndex(elements) {
  return [...elements].sort((a, b) => {
    const ai = typeof a.index === "string", bi = typeof b.index === "string";
    if (ai && bi) {
      if (a.index < b.index) return -1;
      if (a.index > b.index) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }
    if (ai !== bi) return ai ? -1 : 1;   // bez index na koniec
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Scala `remote` do `local`. Zwraca { elements, accepted, rejected }:
 *  - elements: pełna lista po scaleniu, uporządkowana;
 *  - accepted: elementy zdalne, które weszły (do oznaczenia jako znane);
 *  - rejected: elementy zdalne, które przegrały z lokalnymi (lokalna wersja
 *    jest nowsza - po ponownym połączeniu trzeba ją wysłać).
 * `protectIds` - ids elementów w trakcie edycji; zdalna wersja czeka.
 */
export function mergeElements(local, remote, { protectIds } = {}) {
  const map = new Map(local.map((el) => [el.id, el]));
  const accepted = [];
  const rejected = [];
  for (const raw of remote) {
    if (!raw || typeof raw.id !== "string" || !raw.id) continue;
    const el = sanitizeIndex(raw);
    const cur = map.get(el.id);
    if (cur && protectIds && protectIds.has(el.id)) { rejected.push(el); continue; }
    if (wins(el, cur)) {
      map.set(el.id, el);
      accepted.push(el);
    } else if (!cur || versionKey(cur) !== versionKey(el)) {
      rejected.push(el);
    }
  }
  return { elements: orderByIndex([...map.values()]), accepted, rejected };
}

/**
 * Elementy, których wersja różni się od tej zapisanej w `known`
 * (Map id -> versionKey). To jest "co zmieniło się od ostatniej wysyłki".
 */
export function pendingChanges(elements, known) {
  const out = [];
  for (const el of elements) {
    if (known.get(el.id) !== versionKey(el)) out.push(el);
  }
  return out;
}

/** Zapamiętuje wersje elementów jako znane (wysłane lub odebrane). */
export function markKnown(known, elements) {
  for (const el of elements) known.set(el.id, versionKey(el));
  return known;
}

/** Ids elementów, których lokalna kopia wygrała ze stanem `remote`
 *  (po ponownym połączeniu: to trzeba wysłać na serwer). */
export function localWinners(local, remote) {
  const remoteMap = new Map(remote.map((el) => [el.id, el]));
  return local.filter((el) => wins(el, remoteMap.get(el.id)) && versionKey(el) !== versionKey(remoteMap.get(el.id) || {}));
}

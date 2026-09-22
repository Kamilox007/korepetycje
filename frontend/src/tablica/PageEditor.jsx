import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Excalidraw, MainMenu, CaptureUpdateAction } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { api } from "../api";
import { PageSync, fetchFileData } from "./sync";
import { BUILTIN_LIBRARY, isBuiltin, makeLibrarySaver } from "./library";
import { STROKE_MIN, STROKE_MAX } from "./stroke";

/**
 * Jedna strona tablicy w Excalidrawie.
 *
 * Komponent montuje się od nowa przy zmianie strony (klucz w BoardScreen),
 * więc cały stan - scena, pliki, synchronizacja - żyje tylko dla jednej
 * strony. `app_state` (scroll, zoom) jest per przeglądarka i per strona,
 * w localStorage; na serwer nie idzie nigdy, bo zoom jednej osoby skakałby
 * drugiej po ekranie.
 */
const PageEditor = forwardRef(function PageEditor(
  { token, pageId, theme, name, grid, library, strokeWidth, onStrokeWidthChange, onStatus, onPeers, onClosed, onError }, ref,
) {
  const apiRef = useRef(null);

  // Excalidraw ma trzy grubości linii na sztywno (1, 2, 4), ale sam element
  // przyjmuje dowolną - własny wybór z paska tablicy ustawia grubość
  // zaznaczonych elementów i tego, co będzie rysowane dalej.
  useImperativeHandle(ref, () => ({
    /** Okno „zapisz jako obraz" Excalidrawa: PNG/SVG, tło, motyw, schowek. */
    openExport() {
      apiRef.current?.updateScene({ appState: { openDialog: { name: "imageExport" } } });
    },
    setStrokeWidth(width) {
      const a = apiRef.current;
      if (!a) return;
      const selected = a.getAppState().selectedElementIds || {};
      const elements = a.getSceneElementsIncludingDeleted().map((e) =>
        selected[e.id] && !e.isDeleted && "strokeWidth" in e
          ? { ...e, strokeWidth: width, version: e.version + 1,
              versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() }
          : e,
      );
      a.updateScene({
        elements,
        appState: { currentItemStrokeWidth: width },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
  }));
  const syncRef = useRef(null);
  const [initialData, setInitialData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const viewKey = `tablica:${token}:${pageId}:view`;
  const collaborators = useRef(new Map());
  const peerMeta = useRef(new Map());

  // Callbacks that may change identity (name, handlers) are read through a
  // ref, so the sync object built once below always sees the latest.
  const latest = useRef({});
  latest.current = { name, onStatus, onPeers, onClosed, onError };
  // Wbudowane bryły + dodatki użytkownika (z konta albo z przeglądarki);
  // zmiany odkładane przez store z BoardScreen, żeby nie mnożyć zapisów
  // przy przełączaniu stron.
  const saveLibrary = useMemo(
    () => makeLibrarySaver(library, (m) => latest.current.onError?.(m)),
    [library],
  );

  // --- wczytanie strony ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await api.boardPage(token, pageId);
        const imageIds = [...new Set(
          page.elements.filter((e) => e.type === "image" && e.fileId && !e.isDeleted).map((e) => e.fileId),
        )];
        const files = (await Promise.all(imageIds.map((id) => fetchFileData(token, id)))).filter(Boolean);
        let appState = {};
        try { appState = JSON.parse(localStorage.getItem(viewKey) || "{}"); } catch { /* brak */ }
        if (cancelled) return;
        const sync = new PageSync({
          token, pageId,
          getName: () => latest.current.name || "Gość",
          onStatus: (s) => latest.current.onStatus?.(s),
          onError: (m) => latest.current.onError?.(m),
          onClosed: (c) => latest.current.onClosed?.(c),
          onPeers: (peers, selfId) => {
            peerMeta.current = new Map(peers.filter((p) => p.peer_id !== selfId).map((p) => [p.peer_id, p]));
            // usuń kursory osób, które wyszły
            for (const id of [...collaborators.current.keys()]) {
              if (!peerMeta.current.has(id)) collaborators.current.delete(id);
            }
            pushCollaborators();
            latest.current.onPeers?.(peers, selfId);
          },
          onPointer: (peerId, p) => {
            const meta = peerMeta.current.get(peerId);
            if (!meta) return;
            collaborators.current.set(peerId, {
              username: meta.name, button: p.button,
              pointer: { x: p.x, y: p.y, tool: "pointer" },
              color: meta.is_owner ? { background: "#2f4858", stroke: "#2f4858" } : { background: "#1d7a5f", stroke: "#1d7a5f" },
            });
            pushCollaborators();
          },
          onRemote: (elements) => {
            // NEVER: cudze zmiany nie wchodzą do lokalnej historii undo -
            // inaczej Ctrl+Z u korepetytora cofałoby to, co narysował uczeń.
            apiRef.current?.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
            // Element obrazka przyszedł po WS, ale jego bajty nie: te idą osobno
            // (POST .../files u nadawcy). Bez dociągnięcia zostaje placeholder.
            fetchMissingFiles(elements);
          },
        });
        sync.seed(page.elements, files.map((f) => f.id));
        syncRef.current = sync;
        sync.connect();
        setInitialData({
          elements: page.elements,
          files,
          appState: { ...appState, collaborators: new Map(), currentItemStrokeWidth: strokeWidth || 2 },
          scrollToContent: !appState.scrollX && page.elements.length > 0,
          libraryItems: [...BUILTIN_LIBRARY, ...library.items],
        });
      } catch (e) {
        if (!cancelled) setLoadError(e.message);
      }
    })();
    return () => {
      cancelled = true;
      syncRef.current?.destroy();
      syncRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, pageId]);

  function pushCollaborators() {
    apiRef.current?.updateScene({ collaborators: new Map(collaborators.current) });
  }

  // Obrazki, których bajtów jeszcze nie mamy (wklejone przez kogoś innego,
  // gdy już byliśmy na stronie). Nadawca wysyła element dopiero po udanym
  // uploadzie, ale między jego POST a naszym GET może być chwila - stąd
  // kilka prób z odstępem zamiast jednego strzału.
  const fetching = useRef(new Set());
  async function fetchMissingFiles(elements) {
    const a = apiRef.current;
    if (!a) return;
    const have = a.getFiles();
    const ids = [...new Set(
      elements
        .filter((e) => e.type === "image" && e.fileId && !e.isDeleted && !have[e.fileId])
        .map((e) => e.fileId),
    )].filter((id) => !fetching.current.has(id));
    if (!ids.length) return;
    ids.forEach((id) => fetching.current.add(id));
    try {
      for (const id of ids) {
        let data = null;
        for (let attempt = 0; attempt < 5 && !data; attempt++) {
          if (attempt) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
          data = await fetchFileData(token, id);
        }
        if (data) {
          // Najpierw "znany", potem addFiles: onChange po addFiles nie może
          // wziąć tego pliku za nowy i wysłać go z powrotem na serwer.
          syncRef.current?.knownFiles.add(id);
          apiRef.current?.addFiles([data]);
        } else {
          latest.current.onError?.("Nie udało się pobrać obrazka z tablicy.");
        }
      }
    } finally {
      ids.forEach((id) => fetching.current.delete(id));
    }
  }

  // imię zmienione w trakcie: powiedz reszcie
  useEffect(() => { syncRef.current?.rename(); }, [name]);

  const saveView = useMemo(() => {
    let t = null;
    return (appState) => {
      if (t) return;
      t = setTimeout(() => {
        t = null;
        try {
          localStorage.setItem(viewKey, JSON.stringify({
            scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom,
            viewBackgroundColor: appState.viewBackgroundColor,
          }));
        } catch { /* prywatne okno */ }
      }, 1000);
    };
  }, [viewKey]);

  // Suwak grubości w panelu właściwości Excalidrawa. Excalidraw nie ma na to
  // slotu, więc: obserwujemy DOM edytora, a gdy pojawi się sekcja „Grubość
  // obramowania" (fieldset z przyciskami strokeWidth-*), dokładamy do niej
  // własny kontener i renderujemy w nim suwak przez portal. Panel znika i
  // wraca z każdą zmianą zaznaczenia, stąd obserwator, nie jednorazowe
  // wyszukanie. Fabryczne trzy przyciski chowa CSS.
  const wrapRef = useRef(null);
  const [strokeSlot, setStrokeSlot] = useState(null);
  useEffect(() => {
    const root = wrapRef.current;
    if (!root) return undefined;
    const sync = () => {
      const button = root.querySelector('[data-testid="strokeWidth-thin"]');
      const fieldset = button?.closest("fieldset") || null;
      if (!fieldset) { setStrokeSlot((s) => (s ? null : s)); return; }
      let slot = fieldset.querySelector(".tablica-stroke");
      if (!slot) {
        slot = document.createElement("div");
        slot.className = "tablica-stroke";
        fieldset.appendChild(slot);
      }
      setStrokeSlot((s) => (s === slot ? s : slot));
    };
    const obs = new MutationObserver(sync);
    obs.observe(root, { childList: true, subtree: true });
    sync();
    return () => obs.disconnect();
  }, [initialData]);

  // Kółko myszy nad płótnem przybliża, nie przesuwa. Excalidraw nie ma na to
  // opcji: zoom robi tylko przy Ctrl/Cmd, a zwykły scroll to pan. Łapiemy więc
  // event w fazie capture (przed jego nasłuchem na kontenerze) i wysyłamy go
  // ponownie z ctrlKey - Excalidraw reaguje wyłącznie na cel <canvas>, więc
  // przewijanie biblioteki i menu nie jest ruszane. Shift (pan poziomy) i
  // Alt (pan pionowy, Excalidraw nie patrzy na Alt) przechodzą bez zmian.
  useEffect(() => {
    const root = wrapRef.current;
    if (!root) return undefined;
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || !(e.target instanceof HTMLCanvasElement)) return;
      e.preventDefault();
      e.stopPropagation();
      e.target.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true, cancelable: true, ctrlKey: true,
        deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
        clientX: e.clientX, clientY: e.clientY,
      }));
    };
    root.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => root.removeEventListener("wheel", onWheel, { capture: true });
  }, [initialData]);

  // Po wklejeniu (albo upuszczeniu) obrazka wracamy na wskaźnik, żeby dało się
  // go od razu przesunąć. Excalidraw robi to sam dla wklejonych elementów
  // i tekstu (pasteFromClipboard kończy się setActiveTool "selection"), ale
  // gałąź z plikiem obrazka wychodzi wcześniej - obrazek jest zaznaczony,
  // a aktywny zostaje pisak. Dlatego reagujemy tylko na zdarzenia z plikiem
  // graficznym. Paste łapiemy na dokumencie, bo trafia do elementu z fokusem;
  // warunek „fokus wewnątrz edytora" jest ten sam, którego używa Excalidraw.
  useEffect(() => {
    const isImage = (files) => Array.from(files || []).some((f) => f.type.startsWith("image/"));
    const editable = (node) =>
      node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node?.isContentEditable;
    const toSelection = (files, node) => {
      if (!wrapRef.current?.contains(node) || editable(node) || !isImage(files)) return;
      apiRef.current?.setActiveTool({ type: "selection" });
    };
    const onPaste = (e) => toSelection(e.clipboardData?.files, document.activeElement);
    const onDrop = (e) => toSelection(e.dataTransfer?.files, e.target);
    document.addEventListener("paste", onPaste, true);
    document.addEventListener("drop", onDrop, true);
    return () => {
      document.removeEventListener("paste", onPaste, true);
      document.removeEventListener("drop", onDrop, true);
    };
  }, [initialData]);

  if (loadError) {
    return <div className="tablica-error">Nie udało się wczytać strony: {loadError}</div>;
  }
  if (!initialData) {
    return <div className="tablica-loading">Wczytywanie strony…</div>;
  }

  return (
    <div ref={wrapRef} className="tablica-editor">
    {strokeSlot && createPortal(
      <>
        <span className="tablica-stroke-line" style={{ height: Math.max(1, strokeWidth * 2), opacity: strokeWidth < 0.5 ? 0.5 : 1 }} />
        {/* Skala całkowita 1-40 zamiast 0,1-4 co 0,1: przeglądarka liczy kroki
            od min, a 0,1 + 39 × 0,1 wychodzi o ułamek ponad 4, więc suwak nie
            dojeżdżał do prawego końca (ostatni legalny krok to 3,9). */}
        <input type="range" min={Math.round(STROKE_MIN * 10)} max={Math.round(STROKE_MAX * 10)} step={1}
               value={Math.round(strokeWidth * 10)}
               aria-label="Grubość obramowania"
               onChange={(e) => onStrokeWidthChange?.(Number(e.target.value) / 10)} />
        {/* Pole liczbowe obok suwaka: wpisanie wartości ręcznie, przycięte do
            zakresu i zaokrąglone do 0,1. */}
        <input type="number" className="tablica-stroke-value" min={STROKE_MIN} max={STROKE_MAX} step={0.1}
               value={strokeWidth} aria-label="Grubość obramowania (liczba)"
               onChange={(e) => {
                 const n = Number(e.target.value);
                 if (!Number.isFinite(n)) return;
                 onStrokeWidthChange?.(Math.round(Math.min(STROKE_MAX, Math.max(STROKE_MIN, n)) * 10) / 10);
               }} />
      </>,
      strokeSlot,
    )}
    <Excalidraw
      excalidrawAPI={(a) => {
        apiRef.current = a;
        // Tylko dev server: testy E2E (Playwright) czytają i wstawiają scenę
        // przez to okno, bo płótno to <canvas> i nie da się go odpytać z DOM.
        if (import.meta.env.DEV) window.__tablicaAPI = a;
      }}
      initialData={initialData}
      langCode="pl-PL"
      theme={theme}
      name="Tablica"
      gridModeEnabled={grid}
      onLibraryChange={(items) => {
        // Store pamięta bieżący stan, żeby kolejna strona dostała aktualną
        // listę bez pytania serwera; zapis idzie z opóźnieniem.
        library.items = items.filter((i) => !isBuiltin(i));
        saveLibrary(items);
      }}
      onChange={(elements, appState, files) => {
        syncRef.current?.handleChange(elements, files);
        saveView(appState);
      }}
      onPointerUpdate={({ pointer, button }) => {
        syncRef.current?.pointer(pointer.x, pointer.y, button);
      }}
      UIOptions={{
        canvasActions: {
          loadScene: false,       // scena przychodzi z serwera, nie z pliku
          saveToActiveFile: false,
          clearCanvas: false,     // "wyczyść" na współdzielonej tablicy to kasowanie cudzej pracy
          export: { saveFileToDisk: true },
          saveAsImage: true,
          toggleTheme: false,     // motyw idzie z ustawień panelu
        },
        tools: { image: true },
      }}
    >
      {/* Własne menu: bez „Live collaboration", linków do Excalidraw+ i eksportu do chmury. */}
      <MainMenu>
        <MainMenu.DefaultItems.SaveAsImage />
        <MainMenu.DefaultItems.Export />
        <MainMenu.DefaultItems.Help />
        <MainMenu.Separator />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
    </Excalidraw>
    </div>
  );
});

export default PageEditor;

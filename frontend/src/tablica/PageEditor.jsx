import { useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, MainMenu, CaptureUpdateAction } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { api } from "../api";
import { PageSync, fetchFileData } from "./sync";
import { BUILTIN_LIBRARY, isBuiltin, makeLibrarySaver } from "./library";

/**
 * Jedna strona tablicy w Excalidrawie.
 *
 * Komponent montuje się od nowa przy zmianie strony (klucz w BoardScreen),
 * więc cały stan - scena, pliki, synchronizacja - żyje tylko dla jednej
 * strony. `app_state` (scroll, zoom) jest per przeglądarka i per strona,
 * w localStorage; na serwer nie idzie nigdy, bo zoom jednej osoby skakałby
 * drugiej po ekranie.
 */
export default function PageEditor({ token, pageId, theme, name, grid, library, onStatus, onPeers, onClosed, onError }) {
  const apiRef = useRef(null);
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
          appState: { ...appState, collaborators: new Map() },
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

  if (loadError) {
    return <div className="tablica-error">Nie udało się wczytać strony: {loadError}</div>;
  }
  if (!initialData) {
    return <div className="tablica-loading">Wczytywanie strony…</div>;
  }

  return (
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
  );
}

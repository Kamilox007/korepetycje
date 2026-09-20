/**
 * Synchronizacja jednej strony tablicy z serwerem.
 *
 * Bez Reacta: PageEditor podpina tu API Excalidrawa i przekazuje zdarzenia
 * onChange, a ta klasa pilnuje, co już poszło na serwer, co czeka, i jak
 * to wysłać. Dwie drogi:
 *  - na żywo przez WebSocket (`update` co najwyżej co 80 ms),
 *  - awaryjnie przez PUT, gdy WebSocket nie działa: co 15 s i przy ukryciu
 *    karty. PUT po stronie serwera scala, nie nadpisuje, więc nic nie ginie.
 *
 * Pętla zwrotna: element wstawiony przez `updateScene` odpala `onChange`,
 * który bez zabezpieczenia wysłałby go z powrotem. Dlatego każda wersja,
 * którą wysłaliśmy LUB odebraliśmy, ląduje w `known`; `pendingChanges`
 * porównuje z tym i wysyła tylko to, co naprawdę zmienił użytkownik.
 */
import { api } from "../api";
import { mergeElements, pendingChanges, markKnown, localWinners } from "./reconcile";

const SEND_THROTTLE_MS = 80;
const FALLBACK_SAVE_MS = 15_000;
const POINTER_THROTTLE_MS = 50;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

export class PageSync {
  /**
   * @param {object} o
   * @param {string} o.token
   * @param {number} o.pageId
   * @param {(elements: object[]) => void} o.onRemote  zdalne elementy do wstawienia
   * @param {(status: "live"|"connecting"|"offline") => void} o.onStatus
   * @param {(peers: object[], selfId: string|null) => void} o.onPeers
   * @param {(peerId: string, pointer: {x,y,button}) => void} o.onPointer
   * @param {(code: number) => void} o.onClosed  4404 = strona/tablica zniknęła
   * @param {(msg: string) => void} o.onError
   * @param {() => string} o.getName
   */
  constructor(o) {
    Object.assign(this, o);
    this.known = new Map();          // id -> versionKey (wysłane lub odebrane)
    this.knownFiles = new Set();     // fileId już na serwerze
    this.uploading = new Set();      // fileId w trakcie uploadu
    this.elements = [];              // ostatni stan sceny z onChange
    this.files = {};
    this.ws = null;
    this.status = "connecting";
    this.selfId = null;
    this.closedForGood = false;
    this.sendTimer = null;
    this.fallbackTimer = null;
    this.reconnectTimer = null;
    this.reconnectDelay = RECONNECT_MIN_MS;
    this.lastPointerAt = 0;
    this.onVisibility = () => { if (document.visibilityState === "hidden") this.flush({ keepalive: true }); };
    document.addEventListener("visibilitychange", this.onVisibility);
    this.fallbackTimer = setInterval(() => { if (this.status !== "live") this.flush(); }, FALLBACK_SAVE_MS);
  }

  /** Stan początkowy wczytany przez HTTP - wszystko w nim jest "znane". */
  seed(elements, fileIds) {
    markKnown(this.known, elements);
    for (const id of fileIds) this.knownFiles.add(id);
    this.elements = elements;
  }

  // ------------------------------------------------------------ WebSocket

  connect() {
    if (this.closedForGood || this.ws) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/api/t/${this.token}/ws?page_id=${this.pageId}`;
    this.setStatus("connecting");
    let ws;
    try { ws = new WebSocket(url); } catch { this.scheduleReconnect(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectDelay = RECONNECT_MIN_MS;
      ws.send(JSON.stringify({ t: "hello", name: this.getName() }));
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.handleMessage(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (ev.code === 4404) {
        // Tablica zarchiwizowana, token wymieniony albo strona skasowana:
        // nie ma do czego wracać.
        this.closedForGood = true;
        this.setStatus("offline");
        this.onClosed?.(ev.code);
        return;
      }
      this.setStatus("offline");
      this.scheduleReconnect();
    };
    ws.onerror = () => { /* onclose przyjdzie zaraz po tym */ };
  }

  scheduleReconnect() {
    if (this.closedForGood || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      this.connect();
    }, this.reconnectDelay);
  }

  handleMessage(msg) {
    switch (msg.t) {
      case "init": {
        this.selfId = msg.peer_id;
        // Po (ponownym) połączeniu: serwer ma swój stan, my swój - być może
        // z edycjami zrobionymi offline. Scalamy w obie strony: to, co
        // wygrało u nas, idzie na serwer; to, co wygrało u niego, na ekran.
        const mine = localWinners(this.elements, msg.elements);
        this.applyRemote(msg.elements);
        this.setStatus("live");
        this.onPeers?.(msg.peers || [], this.selfId);
        if (mine.length) this.send({ t: "update", elements: mine }) && markKnown(this.known, mine);
        this.scheduleSend();
        break;
      }
      case "update":
        this.applyRemote(msg.elements || []);
        break;
      case "peers":
        this.onPeers?.(msg.peers || [], this.selfId);
        break;
      case "pointer":
        this.onPointer?.(msg.peer_id, { x: msg.x, y: msg.y, button: msg.button });
        break;
      default:
        break;
    }
  }

  /** Zdalne elementy: scal z lokalnym stanem, oznacz jako znane, wstaw do sceny. */
  applyRemote(remote) {
    if (!remote.length) return;
    const { elements, accepted } = mergeElements(this.elements, remote);
    markKnown(this.known, accepted);
    if (accepted.length) {
      this.elements = elements;
      this.onRemote(elements);
    }
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.onStatus?.(s);
  }

  // ------------------------------------------------------------ zmiany lokalne

  /** Z onChange Excalidrawa. Tanie: tylko zapamiętuje i planuje wysyłkę. */
  handleChange(elements, files) {
    this.elements = elements;
    this.files = files || {};
    this.uploadNewFiles();
    this.scheduleSend();
  }

  scheduleSend() {
    if (this.sendTimer) return;
    this.sendTimer = setTimeout(() => { this.sendTimer = null; this.sendPending(); }, SEND_THROTTLE_MS);
  }

  /** Elementy zmienione od ostatniej wysyłki; obrazki czekają na swój plik. */
  pending() {
    return pendingChanges(this.elements, this.known).filter(
      (el) => !(el.type === "image" && el.fileId && !this.knownFiles.has(el.fileId)),
    );
  }

  sendPending() {
    const batch = this.pending();
    if (!batch.length) return;
    if (this.send({ t: "update", elements: batch })) markKnown(this.known, batch);
    // bez połączenia: zostają w pending, zabierze je flush() po HTTP
  }

  /** Zapis awaryjny przez PUT. `keepalive` - żeby przeżył zamknięcie karty. */
  async flush({ keepalive = false } = {}) {
    if (this.closedForGood) return;
    const batch = this.pending();
    if (!batch.length) return;
    try {
      const res = await fetch(`/api/t/${this.token}/pages/${this.pageId}`, {
        method: "PUT", keepalive, credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elements: batch }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      markKnown(this.known, batch);
      const data = await res.json();
      // Serwer odpowiada stanem po scaleniu - mogły w nim być cudze zmiany.
      this.applyRemote(data.elements || []);
    } catch (e) {
      this.onError?.("Nie udało się zapisać zmian: " + e.message);
    }
  }

  // ------------------------------------------------------------ pliki

  uploadNewFiles() {
    for (const [id, f] of Object.entries(this.files)) {
      if (this.knownFiles.has(id) || this.uploading.has(id)) continue;
      this.uploading.add(id);
      this.upload(id, f).finally(() => {
        this.uploading.delete(id);
        this.scheduleSend();   // teraz element obrazka może wyjść
      });
    }
  }

  async upload(id, f) {
    try {
      const blob = await (await fetch(f.dataURL)).blob();
      await api.uploadBoardFile(this.token, id, blob);
      this.knownFiles.add(id);
    } catch (e) {
      this.onError?.("Nie udało się wysłać obrazka: " + e.message);
    }
  }

  // ------------------------------------------------------------ kursor

  pointer(x, y, button) {
    const now = Date.now();
    if (now - this.lastPointerAt < POINTER_THROTTLE_MS) return;
    this.lastPointerAt = now;
    this.send({ t: "pointer", x, y, button });
  }

  rename() {
    this.send({ t: "hello", name: this.getName() });
  }

  // ------------------------------------------------------------ koniec

  destroy() {
    document.removeEventListener("visibilitychange", this.onVisibility);
    clearInterval(this.fallbackTimer);
    clearTimeout(this.sendTimer);
    clearTimeout(this.reconnectTimer);
    // Zaległe zmiany: przez WS, jeśli jest, inaczej PUT z keepalive.
    if (!this.closedForGood) {
      if (this.status === "live") this.sendPending(); else this.flush({ keepalive: true });
    }
    this.closedForGood = true;
    if (this.ws) { const ws = this.ws; this.ws = null; ws.close(); }
  }
}

/** Zamienia plik z Excalidrawa na BinaryFileData po pobraniu z serwera. */
export async function fetchFileData(token, fileId) {
  const res = await fetch(api.boardFileUrl(token, fileId), { credentials: "same-origin" });
  if (!res.ok) return null;
  const blob = await res.blob();
  const dataURL = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
  return { id: fileId, dataURL, mimeType: blob.type, created: Date.now() };
}

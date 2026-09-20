import { useCallback, useEffect, useId, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useConfirm } from "../Confirm";
import { useTheme } from "../useTheme";
import Modal from "../Modal";
import PageEditor from "./PageEditor";
import { openLibraryStore } from "./library";
import "./tablica.css";

/**
 * Ekran tablicy pod /t/{token} - poza layoutem panelu.
 *
 * Gość (uczeń) widzi tylko strony i płótno. Właściciel (zalogowany twórca
 * albo staff, rozpoznany po ciasteczku) dostaje dodatkowo pasek narzędzi:
 * dodawanie, zmiana nazwy i kasowanie stron oraz powrót do panelu.
 */
export default function BoardScreen() {
  const { token } = useParams();
  const confirm = useConfirm();
  const { theme } = useTheme();
  const [board, setBoard] = useState(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState("");
  const [pageId, setPageId] = useState(null);
  const [name, setName] = useState(() => read(`tablica:${token}:name`) || "");
  const [askName, setAskName] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [peers, setPeers] = useState([]);
  const [notice, setNotice] = useState("");
  // Kratka to ustawienie widoku tej przeglądarki, pamiętane per tablica.
  const [grid, setGrid] = useState(() => read(`tablica:${token}:grid`) === "1");
  // Biblioteka kształtów: otwierana raz na wejściu (konto albo przeglądarka),
  // wspólna dla wszystkich stron tej tablicy.
  const [library, setLibrary] = useState(null);

  const load = useCallback(async () => {
    try {
      const b = await api.board(token);
      setBoard(b);
      setGone(false);
      return b;
    } catch (e) {
      if (String(e.message).includes("404") || /nie znaleziona/i.test(e.message)) setGone(true);
      else setError(e.message);
      return null;
    }
  }, [token]);

  useEffect(() => {
    document.title = "Tablica";
    (async () => {
      const [b, lib] = await Promise.all([load(), openLibraryStore()]);
      setLibrary(lib);
      if (!b) return;
      const remembered = Number(read(`tablica:${token}:page`));
      const first = b.pages.find((p) => p.id === remembered) || b.pages[0];
      setPageId(first ? first.id : null);
      if (!b.is_owner && !read(`tablica:${token}:name`)) setAskName(true);
      if (b.is_owner && !read(`tablica:${token}:name`)) {
        // Właściciel: imię z konta, bez pytania.
        try { const me = await api.me(); saveName(me.display_name || me.username); } catch { /* gość */ }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (board) document.title = `${board.title} - Tablica`;
  }, [board]);

  function saveName(n) {
    const clean = (n || "").trim().slice(0, 40);
    setName(clean);
    write(`tablica:${token}:name`, clean);
  }

  function toggleGrid() {
    setGrid((g) => { write(`tablica:${token}:grid`, g ? "0" : "1"); return !g; });
  }

  function selectPage(id) {
    setPageId(id);
    write(`tablica:${token}:page`, String(id));
  }

  async function addPage() {
    try {
      const p = await api.addBoardPage(token);
      const b = await load();
      if (b) selectPage(p.id);
    } catch (e) { setError(e.message); }
  }

  async function rename(page, title) {
    try {
      await api.renameBoardPage(token, page.id, title);
      setRenaming(null);
      load();
    } catch (e) { setError(e.message); }
  }

  async function removePage(page) {
    const ok = await confirm({
      title: "Usunąć stronę?",
      message: `Strona „${page.title}" zostanie usunięta razem z jej zapisanymi stanami.`,
      consequence: "Osoby, które ją oglądają, zostaną z niej wyrzucone.",
      confirmLabel: "Usuń stronę",
    });
    if (!ok) return;
    try {
      await api.deleteBoardPage(token, page.id);
      const b = await load();
      if (b && pageId === page.id) selectPage(b.pages[0]?.id ?? null);
    } catch (e) { setError(e.message); }
  }

  // Strona zniknęła pod nami (właściciel skasował, token wymieniony,
  // tablica zarchiwizowana): sprawdź, co zostało.
  async function onClosed() {
    const b = await load();
    if (b && !b.pages.some((p) => p.id === pageId)) {
      selectPage(b.pages[0]?.id ?? null);
      setNotice("Ta strona została usunięta - przełączono na pierwszą.");
    }
  }

  if (gone) {
    return (
      <div className="tablica-gone">
        <h1>Ta tablica nie jest dostępna</h1>
        <p>Link jest nieprawidłowy albo przestał działać. Poproś korepetytora o nowy.</p>
      </div>
    );
  }
  if (!board) {
    return <div className="tablica-loading">{error || "Wczytywanie tablicy…"}</div>;
  }

  const current = board.pages.find((p) => p.id === pageId) || null;
  const others = peers.filter((p) => !p.self);

  return (
    <div className={`tablica ${theme === "dark" ? "tablica-dark" : ""}`}>
      <header className="tablica-bar">
        <div className="tablica-title" title={board.title}>{board.title}</div>
        <nav className="tablica-pages" aria-label="Strony">
          {board.pages.map((p) => (
            <button
              key={p.id}
              className={`tablica-page${p.id === pageId ? " active" : ""}`}
              onClick={() => selectPage(p.id)}
              onDoubleClick={() => board.is_owner && setRenaming(p)}
              title={board.is_owner ? "Dwuklik: zmień nazwę" : undefined}
            >
              {p.title}
            </button>
          ))}
          {board.is_owner && (
            <button className="tablica-page tablica-add" onClick={addPage} aria-label="Nowa strona" title="Nowa strona">+</button>
          )}
        </nav>
        <div className="tablica-right">
          {others.length > 0 && (
            <span className="tablica-peers" title={others.map((p) => p.name).join(", ")}>
              {others.map((p) => (
                <span key={p.peer_id} className={`tablica-peer${p.is_owner ? " owner" : ""}`}>{initials(p.name)}</span>
              ))}
            </span>
          )}
          <button className={`ghost tablica-btn${grid ? " active" : ""}`} onClick={toggleGrid}
                  aria-pressed={grid} title="Kratka (tylko na Twoim ekranie)">Kratka</button>
          <span className={`tablica-status ${status}`}>
            {status === "live" ? "na żywo" : status === "connecting" ? "łączenie…" : "offline - zmiany zapisywane co 15 s"}
          </span>
          {board.is_owner ? (
            <>
              {current && board.pages.length > 1 && (
                <button className="ghost tablica-btn" onClick={() => removePage(current)}>Usuń stronę</button>
              )}
              <Link className="tablica-btn tablica-link" to="/tablice">Panel</Link>
            </>
          ) : (
            <button className="ghost tablica-btn" onClick={() => setAskName(true)} title="Imię przy kursorze">
              {name || "Gość"}
            </button>
          )}
        </div>
      </header>

      {error && <div className="tablica-notice err" onClick={() => setError("")}>{error}</div>}
      {notice && <div className="tablica-notice" onClick={() => setNotice("")}>{notice}</div>}

      <div className="tablica-canvas">
        {current && library ? (
          <PageEditor
            key={current.id}
            token={token}
            pageId={current.id}
            theme={theme}
            name={name}
            grid={grid}
            library={library}
            onStatus={setStatus}
            onPeers={(ps, selfId) => setPeers(ps.map((p) => ({ ...p, self: p.peer_id === selfId })))}
            onClosed={onClosed}
            onError={setError}
          />
        ) : (
          <div className="tablica-loading">Ta tablica nie ma żadnej strony.</div>
        )}
      </div>

      {askName && (
        <NameModal
          initial={name}
          onClose={() => { if (!name) saveName("Gość"); setAskName(false); }}
          onSave={(n) => { saveName(n); setAskName(false); }}
        />
      )}
      {renaming && (
        <RenameModal page={renaming} onClose={() => setRenaming(null)} onSave={(t) => rename(renaming, t)} />
      )}
    </div>
  );
}

function initials(n) {
  return (n || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key, value) { try { localStorage.setItem(key, value); } catch { /* prywatne okno */ } }

function NameModal({ initial, onClose, onSave }) {
  const uid = useId();
  const [value, setValue] = useState(initial || "");
  return (
    <Modal title="Jak masz na imię?" onClose={onClose}
      footer={<button className="primary" onClick={() => onSave(value)}>Gotowe</button>}>
      <p style={{ margin: 0 }}>Imię pojawi się przy Twoim kursorze, żeby było widać, kto rysuje. Nigdzie nie jest zapisywane poza tą przeglądarką.</p>
      <div className="field">
        <label htmlFor={`${uid}-imie`}>Imię</label>
        <input id={`${uid}-imie`} autoFocus value={value} maxLength={40}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSave(value)} placeholder="np. Kasia" />
      </div>
    </Modal>
  );
}

function RenameModal({ page, onClose, onSave }) {
  const uid = useId();
  const [value, setValue] = useState(page.title);
  return (
    <Modal title="Nazwa strony" onClose={onClose}
      footer={<><button onClick={onClose}>Anuluj</button><button className="primary" onClick={() => onSave(value)} disabled={!value.trim()}>Zapisz</button></>}>
      <div className="field">
        <label htmlFor={`${uid}-tytul`}>Tytuł</label>
        <input id={`${uid}-tytul`} autoFocus value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && value.trim() && onSave(value)} />
      </div>
    </Modal>
  );
}

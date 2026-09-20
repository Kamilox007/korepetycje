import { useCallback, useEffect, useId, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "./api";
import { useConfirm } from "./Confirm";
import Modal from "./Modal";

/**
 * Lista tablic w panelu (staff i korepetytor).
 *
 * Tablica to link: kto go ma, ten rysuje. Panel służy do założenia tablicy,
 * skopiowania linku, wymiany go na nowy (gdy wyciekł) i do odzysku ze
 * snapshotu. Samo rysowanie odbywa się pod /t/{token}, poza panelem.
 */
export default function Boards({ myRole }) {
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const studentFilter = params.get("uczen") ? Number(params.get("uczen")) : null;

  const [boards, setBoards] = useState([]);
  const [archived, setArchived] = useState([]);
  const [students, setStudents] = useState([]);
  const [showArchive, setShowArchive] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editBoard, setEditBoard] = useState(null);
  const [historyBoard, setHistoryBoard] = useState(null);
  const [linkBoard, setLinkBoard] = useState(null);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  const isStaff = myRole === "admin" || myRole === "secretary";

  const load = useCallback(async () => {
    try {
      const [live, arch] = await Promise.all([
        api.listBoards({ studentId: studentFilter }),
        api.listBoards({ studentId: studentFilter, archived: true }),
      ]);
      setBoards(live);
      setArchived(arch);
      setErr("");
    } catch (e) { setErr("Nie udało się pobrać tablic: " + e.message); }
  }, [studentFilter]);

  useEffect(() => { load(); }, [load]);

  // Staff pick from the full student list; a tutor has no such endpoint and
  // sees the students they teach, the same set as their Rozliczenia.
  useEffect(() => {
    (async () => {
      try {
        if (isStaff) {
          setStudents(await api.listStudents());
        } else {
          const s = await api.tutorSummary();
          setStudents(s.students.map((x) => ({ id: x.student_id, name: x.student_name })));
        }
      } catch { setStudents([]); }
    })();
  }, [isStaff]);

  function flash(text) {
    setNotice(text);
    setTimeout(() => setNotice(""), 2500);
  }

  async function copyLink(b) {
    const url = window.location.origin + b.path;
    try {
      await navigator.clipboard.writeText(url);
      flash("Link skopiowany do schowka.");
    } catch {
      // Clipboard needs HTTPS or localhost; on plain HTTP show it to copy by hand.
      setLinkBoard(b);
    }
  }

  async function rotate(b) {
    const ok = await confirm({
      title: "Wygenerować nowy link?",
      message: `Stary link do tablicy „${b.title}" przestanie działać natychmiast. Treść tablicy zostaje.`,
      consequence: "Osoby aktualnie połączone zostaną rozłączone. Nowy link trzeba wysłać uczniowi ponownie.",
      confirmLabel: "Nowy link",
      danger: false,
    });
    if (!ok) return;
    try {
      const updated = await api.rotateBoardToken(b.id);
      await load();
      setLinkBoard(updated);
    } catch (e) { setErr(e.message); }
  }

  async function archive(b) {
    const ok = await confirm({
      title: "Zarchiwizować tablicę?",
      message: `Tablica „${b.title}" zniknie z listy, a jej link przestanie działać.`,
      consequence: "Treść zostaje. Tablicę można przywrócić z archiwum; link zacznie wtedy działać ponownie.",
      confirmLabel: "Archiwizuj",
      danger: false,
    });
    if (!ok) return;
    try { await api.archiveBoard(b.id); load(); } catch (e) { setErr(e.message); }
  }

  async function restore(b) {
    try { await api.restoreBoard(b.id); load(); } catch (e) { setErr(e.message); }
  }

  async function purge(b) {
    const ok = await confirm({
      title: "Usunąć tablicę trwale?",
      message: `Wszystkie strony, obrazki i snapshoty tablicy „${b.title}" zostaną usunięte bez możliwości odzyskania.`,
      consequence: "To nie jest archiwizacja - danych nie da się przywrócić.",
      confirmLabel: "Usuń trwale",
      requireText: b.title,
    });
    if (!ok) return;
    try { await api.purgeBoard(b.id); load(); } catch (e) { setErr(e.message); }
  }

  const filterName = studentFilter && (students.find((s) => s.id === studentFilter)?.name
    || boards.concat(archived).find((b) => b.student_id === studentFilter)?.student_name);

  return (
    <div>
      <div className="page-head">
        <h1>Tablice</h1>
        <button className="primary" onClick={() => setShowCreate(true)}>+ Tablica</button>
      </div>

      {err && <div className="err">{err}</div>}
      {notice && <div className="notice">{notice}</div>}

      {studentFilter && (
        <div className="row" style={{ marginBottom: 12, gap: 8 }}>
          <span className="badge plan">uczeń: {filterName || `#${studentFilter}`}</span>
          <button className="ghost" onClick={() => setParams({})}>Pokaż wszystkie</button>
        </div>
      )}

      {archived.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button className="ghost" onClick={() => setShowArchive((v) => !v)}>
            {showArchive ? "Ukryj archiwum" : `Archiwum (${archived.length})`}
          </button>
        </div>
      )}

      {showArchive && archived.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <table>
            <thead><tr><th>Tablica</th><th>Uczeń</th><th>Zarchiwizowana</th><th></th></tr></thead>
            <tbody>
              {archived.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 500 }}>{b.title}</td>
                  <td className="muted">{b.student_name || "-"}</td>
                  <td className="muted">{(b.archived_at || "").slice(0, 10)}</td>
                  <td className="num">
                    <button className="ghost" onClick={() => restore(b)}>Przywróć</button>
                    {myRole === "admin" ? (
                      <button className="ghost danger" onClick={() => purge(b)}>Usuń trwale</button>
                    ) : (
                      <span className="muted" style={{ fontSize: 12 }}>tylko administrator</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        {boards.length === 0 ? (
          <div className="empty">
            <p>Nie ma jeszcze żadnej tablicy.</p>
            <button className="primary" onClick={() => setShowCreate(true)}>Załóż pierwszą tablicę</button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tablica</th><th>Uczeń</th>
                {isStaff && <th>Założył(a)</th>}
                <th className="num">Strony</th><th>Ostatnio otwarta</th><th></th>
              </tr>
            </thead>
            <tbody>
              {boards.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 500 }}>
                    <a href={b.path} target="_blank" rel="noopener">{b.title}</a>
                  </td>
                  <td className="muted">{b.student_name || "-"}</td>
                  {isStaff && <td className="muted">{b.created_by_name || "-"}</td>}
                  <td className="num">{b.page_count}</td>
                  <td className="muted">{fmtWhen(b.last_opened_at)}</td>
                  <td className="num board-actions">
                    <button className="ghost" onClick={() => copyLink(b)}>Kopiuj link</button>
                    <button className="ghost" onClick={() => setHistoryBoard(b)}>Historia</button>
                    <button className="ghost" onClick={() => setEditBoard(b)}>Edytuj</button>
                    <button className="ghost" onClick={() => rotate(b)}>Nowy link</button>
                    <button className="ghost" onClick={() => archive(b)}>Archiwizuj</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <BoardForm
          students={students}
          initialStudentId={studentFilter}
          onClose={() => setShowCreate(false)}
          onSaved={(b) => { setShowCreate(false); load(); setLinkBoard(b); }}
        />
      )}
      {editBoard && (
        <BoardForm
          board={editBoard}
          students={students}
          onClose={() => setEditBoard(null)}
          onSaved={() => { setEditBoard(null); load(); }}
        />
      )}
      {historyBoard && (
        <HistoryModal board={historyBoard} onClose={() => setHistoryBoard(null)} />
      )}
      {linkBoard && (
        <LinkModal board={linkBoard} onClose={() => setLinkBoard(null)} />
      )}
    </div>
  );
}

function fmtWhen(iso) {
  if (!iso) return "nigdy";
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return d.toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
}

function BoardForm({ board, students, initialStudentId, onClose, onSaved }) {
  const uid = useId();
  const [title, setTitle] = useState(board?.title || "");
  const [studentId, setStudentId] = useState(board?.student_id ?? initialStudentId ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim()) { setErr("Podaj tytuł tablicy."); return; }
    setBusy(true); setErr("");
    try {
      const payload = { title: title.trim(), student_id: studentId === "" ? null : Number(studentId) };
      const saved = board ? await api.updateBoard(board.id, payload) : await api.createBoard(payload);
      onSaved(saved);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <Modal
      title={board ? "Edytuj tablicę" : "Nowa tablica"}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Anuluj</button>
          <button className="primary" onClick={save} disabled={busy}>
            {board ? "Zapisz" : "Załóż tablicę"}
          </button>
        </>
      }
    >
      {err && <div className="err">{err}</div>}
      <div className="field">
        <label htmlFor={`${uid}-tytul`}>Tytuł</label>
        <input id={`${uid}-tytul`} autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()} placeholder="np. Kasia - matura rozszerzona" />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-uczen`}>Uczeń (opcjonalnie)</label>
        <select id={`${uid}-uczen`} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">- bez przypisania -</option>
          {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
          Przypisanie służy tylko do odnalezienia tablicy przy uczniu. Dostęp daje link, nie konto.
        </p>
      </div>
    </Modal>
  );
}

function LinkModal({ board, onClose }) {
  const uid = useId();
  const url = window.location.origin + board.path;
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* zaznacz ręcznie */ }
  }
  return (
    <Modal title="Link do tablicy" onClose={onClose}
      footer={<><button onClick={copy}>{copied ? "Skopiowano" : "Kopiuj"}</button><button className="primary" onClick={onClose}>Gotowe</button></>}>
      <p style={{ margin: 0 }}>Wyślij ten link uczniowi. Kto go ma, może rysować po tablicy „{board.title}".</p>
      <div className="field">
        <label htmlFor={`${uid}-link`}>Link</label>
        <input id={`${uid}-link`} readOnly value={url} onFocus={(e) => e.target.select()} />
      </div>
    </Modal>
  );
}

function HistoryModal({ board, onClose }) {
  const confirm = useConfirm();
  const [snaps, setSnaps] = useState(null);
  const [pages, setPages] = useState([]);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    (async () => {
      try {
        // The page list gives today's title next to the one the snapshot
        // remembers, in case the page was renamed since.
        const [s, detail] = await Promise.all([api.listBoardSnapshots(board.id), api.getBoard(board.id)]);
        setSnaps(s);
        setPages(detail.pages || []);
      } catch (e) { setErr(e.message); setSnaps([]); }
    })();
  }, [board.id]);

  async function restore(s) {
    const ok = await confirm({
      title: "Przywrócić stan strony?",
      message: `Strona „${s.title}" wróci do stanu z ${fmtWhen(s.created_at)}.`,
      consequence: "Obecny stan strony zostanie najpierw zapisany jako snapshot, więc tę operację da się cofnąć. Osoby połączone na żywo zobaczą zmianę od razu.",
      confirmLabel: "Przywróć",
      danger: false,
    });
    if (!ok) return;
    try {
      await api.restoreBoardSnapshot(board.id, s.id);
      setDone(`Przywrócono stan z ${fmtWhen(s.created_at)}.`);
      setSnaps(await api.listBoardSnapshots(board.id));
    } catch (e) { setErr(e.message); }
  }

  const pageTitle = (id) => pages.find((p) => p.id === id)?.title;

  return (
    <Modal title={`Historia: ${board.title}`} onClose={onClose}
      footer={<button className="primary" onClick={onClose}>Zamknij</button>}>
      {err && <div className="err">{err}</div>}
      {done && <div className="notice">{done}</div>}
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Przed pierwszym zapisem każdego dnia stan strony jest odkładany na 30 dni. Przywrócenie
        cofa stronę do tego stanu - np. po przypadkowym skasowaniu wszystkiego.
      </p>
      {snaps === null ? (
        <div className="muted">Ładowanie…</div>
      ) : snaps.length === 0 ? (
        <div className="empty" style={{ padding: 20 }}><p>Brak zapisanych stanów.</p></div>
      ) : (
        <table>
          <thead><tr><th>Strona</th><th>Stan z</th><th></th></tr></thead>
          <tbody>
            {snaps.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.title}
                  {pageTitle(s.page_id) && pageTitle(s.page_id) !== s.title && (
                    <span className="muted" style={{ fontSize: 12 }}> (teraz: {pageTitle(s.page_id)})</span>
                  )}
                </td>
                <td className="muted">{fmtWhen(s.created_at)}</td>
                <td className="num"><button className="ghost" onClick={() => restore(s)}>Przywróć</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

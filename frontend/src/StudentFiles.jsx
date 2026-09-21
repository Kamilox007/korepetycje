import { useEffect, useId, useRef, useState } from "react";
import { api } from "./api";
import { useConfirm } from "./Confirm";
import Modal from "./Modal";

/**
 * Materiały ucznia (PDF): lista, wysyłka, usuwanie.
 *
 * Jeden panel dla dwóch miejsc: staff otwiera go z listy uczniów jako okno
 * modalne, korepetytor ma osobną zakładkę z wyborem ucznia. Uczeń dostaje
 * te same pliki tylko do odczytu w swoim panelu (StudentPanel).
 */
export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return d.toLocaleDateString("pl-PL");
}

export default function StudentFiles({ student }) {
  const uid = useId();
  const confirm = useConfirm();
  const inputRef = useRef(null);
  const [files, setFiles] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setFiles(await api.listStudentFiles(student.id)); setErr(""); }
    catch (e) { setErr(e.message); setFiles([]); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [student.id]);

  async function upload(list) {
    const chosen = [...(list || [])];
    if (!chosen.length) return;
    setBusy(true); setErr("");
    try {
      // Po kolei, nie równolegle: quota liczona jest na serwerze per plik,
      // a przy kilku naraz komunikat o przekroczeniu byłby loterią.
      for (const f of chosen) await api.uploadStudentFile(student.id, f);
      await load();
    } catch (e) { setErr(e.message); await load(); }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function remove(f) {
    const ok = await confirm({
      title: "Usunąć plik?",
      message: `Plik „${f.name}" zniknie z materiałów ucznia ${student.name}.`,
      consequence: "Uczeń straci do niego dostęp. Tego nie da się cofnąć - trzeba by wysłać plik ponownie.",
      confirmLabel: "Usuń plik",
    });
    if (!ok) return;
    try { await api.deleteStudentFile(student.id, f.id); await load(); }
    catch (e) { setErr(e.message); }
  }

  return (
    <div className="student-files">
      {err && <div className="err">{err}</div>}
      <div className="field">
        <label htmlFor={`${uid}-plik`}>Dodaj PDF (do 20 MB każdy)</label>
        <input id={`${uid}-plik`} ref={inputRef} type="file" accept="application/pdf,.pdf" multiple
               disabled={busy} onChange={(e) => upload(e.target.files)} />
      </div>
      {files === null ? (
        <div className="muted">Ładowanie…</div>
      ) : files.length === 0 ? (
        <div className="empty" style={{ padding: 20 }}><p>Brak materiałów.</p></div>
      ) : (
        <table>
          <thead><tr><th>Plik</th><th>Dodano</th><th className="num">Rozmiar</th><th></th></tr></thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <td>
                  <a href={api.studentFileUrl(student.id, f.id)} target="_blank" rel="noopener">{f.name}</a>
                  {f.uploaded_by_name && <span className="muted" style={{ fontSize: 12 }}> · {f.uploaded_by_name}</span>}
                </td>
                <td className="muted">{fmtWhen(f.created_at)}</td>
                <td className="num muted">{fmtBytes(f.bytes)}</td>
                <td className="num"><button className="ghost danger" onClick={() => remove(f)}>Usuń</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Okno z materiałami jednego ucznia - dla listy uczniów u staff. */
export function StudentFilesModal({ student, onClose }) {
  return (
    <Modal title={`Materiały: ${student.name}`} onClose={onClose} className="overlay-wide"
           footer={<button className="primary" onClick={onClose}>Zamknij</button>}>
      <StudentFiles student={student} />
    </Modal>
  );
}

/** Zakładka korepetytora: wybór ucznia (z tych, których uczy) i jego materiały. */
export function TutorMaterials() {
  const uid = useId();
  const [students, setStudents] = useState(null);
  const [studentId, setStudentId] = useState("");
  useEffect(() => {
    api.tutorSummary()
      .then((s) => {
        const list = s.students.map((x) => ({ id: x.student_id, name: x.student_name }));
        setStudents(list);
        if (list.length && !studentId) setStudentId(String(list[0].id));
      })
      .catch(() => setStudents([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const student = students?.find((s) => String(s.id) === studentId);
  return (
    <div>
      <div className="page-head"><h1>Materiały</h1></div>
      <p className="muted" style={{ marginTop: -10 }}>
        Pliki PDF dla ucznia - zadania, rozwiązania, notatki. Uczeń widzi je w swoim panelu obok tablic.
      </p>
      {students === null ? (
        <div className="empty">Ładowanie…</div>
      ) : students.length === 0 ? (
        <div className="card"><div className="empty"><p>Nie masz jeszcze uczniów z zajęciami.</p></div></div>
      ) : (
        <div className="card" style={{ padding: "16px 20px" }}>
          <div className="field" style={{ maxWidth: 360 }}>
            <label htmlFor={`${uid}-uczen`}>Uczeń</label>
            <select id={`${uid}-uczen`} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {student && <StudentFiles key={student.id} student={student} />}
        </div>
      )}
    </div>
  );
}

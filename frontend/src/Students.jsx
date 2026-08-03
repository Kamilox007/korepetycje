import { useState, useEffect } from "react";
import { api } from "./api";
import Modal from "./Modal";
import { DAYS_PL, fmtMoney, fmtTime } from "./dates";

export default function Students({ students, reload }) {
  const [series, setSeries] = useState([]);
  const [showStudent, setShowStudent] = useState(false);
  const [showSeries, setShowSeries] = useState(false);
  const [accountFor, setAccountFor] = useState(null);

  async function loadSeries() {
    setSeries(await api.listSeries());
  }
  useEffect(() => { loadSeries(); }, []);

  async function removeStudent(s) {
    if (!confirm(`Usunąć ucznia ${s.name} wraz z całą historią?`)) return;
    await api.deleteStudent(s.id);
    reload();
  }

  async function removeSeries(srs) {
    if (!confirm("Zakończyć tę serię cykliczną? Przyszłe nieodbyte zajęcia zostaną usunięte.")) return;
    await api.deleteSeries(srs.id);
    loadSeries();
    reload();
  }

  function studentName(id) {
    return students.find((s) => s.id === id)?.name || "—";
  }

  const activeSeries = series.filter((s) => s.active);

  return (
    <div>
      <div className="page-head">
        <h1>Uczniowie</h1>
        <div className="row">
          <button onClick={() => setShowSeries(true)}>+ Zajęcia cykliczne</button>
          <button className="primary" onClick={() => setShowStudent(true)}>+ Uczeń</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        {students.length === 0 ? (
          <div className="empty">
            <p>Nie masz jeszcze żadnych uczniów.</p>
            <button className="primary" onClick={() => setShowStudent(true)}>Dodaj pierwszego ucznia</button>
          </div>
        ) : (
          <table>
            <thead>
              <tr><th>Imię i nazwisko</th><th>Kontakt</th><th className="num">Domyślna cena</th><th>Konto ucznia</th><th></th></tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 500 }}>{s.name}</td>
                  <td className="muted">{s.contact || "—"}</td>
                  <td className="num">{fmtMoney(s.default_price)}</td>
                  <td>
                    {s.has_account
                      ? <span className="badge done">ma konto</span>
                      : <button className="ghost" onClick={() => setAccountFor(s)}>Załóż konto</button>}
                  </td>
                  <td className="num">
                    <button className="ghost danger" onClick={() => removeStudent(s)}>Usuń</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Zajęcia cykliczne</h2>
      <div className="card">
        {activeSeries.length === 0 ? (
          <div className="empty"><p>Brak aktywnych serii cyklicznych.</p></div>
        ) : (
          <table>
            <thead>
              <tr><th>Uczeń</th><th>Dzień</th><th>Godzina</th><th className="num">Cena</th><th>Od</th><th></th></tr>
            </thead>
            <tbody>
              {activeSeries.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 500 }}>{studentName(s.student_id)}</td>
                  <td>{DAYS_PL[s.weekday]}</td>
                  <td>{fmtTime(s.start_time)}</td>
                  <td className="num">{fmtMoney(s.price)}</td>
                  <td className="muted">{s.start_date}</td>
                  <td className="num">
                    <button className="ghost danger" onClick={() => removeSeries(s)}>Zakończ</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showStudent && (
        <StudentForm
          onClose={() => setShowStudent(false)}
          onSaved={() => { setShowStudent(false); reload(); }}
        />
      )}
      {showSeries && (
        <SeriesForm
          students={students}
          onClose={() => setShowSeries(false)}
          onSaved={() => { setShowSeries(false); loadSeries(); reload(); }}
        />
      )}
      {accountFor && (
        <AccountForm
          student={accountFor}
          onClose={() => setAccountFor(null)}
          onSaved={() => { setAccountFor(null); reload(); }}
        />
      )}
    </div>
  );
}

function AccountForm({ student, onClose, onSaved }) {
  const suggested = student.name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
  const [username, setUsername] = useState(suggested);
  const [password, setPassword] = useState(genPassword());
  const [created, setCreated] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function genPassword() {
    return Math.random().toString(36).slice(2, 8) + Math.floor(Math.random() * 90 + 10);
  }

  async function save() {
    setErr("");
    setBusy(true);
    try {
      const res = await api.createStudentAccount(student.id, { username: username.trim(), password });
      setCreated(res);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  if (created) {
    return (
      <Modal title="Konto utworzone" onClose={onSaved}
        footer={<button className="primary" onClick={onSaved}>Gotowe</button>}>
        <p style={{ margin: 0 }}>Przekaż uczniowi te dane logowania. Hasło widać tylko teraz:</p>
        <div className="cred-box">
          <div><span className="muted">Login:</span> <strong>{created.username}</strong></div>
          <div><span className="muted">Hasło:</span> <strong>{created.password}</strong></div>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Uczeń zostanie poproszony o zmianę hasła przy pierwszym logowaniu.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Konto dla: ${student.name}`}
      onClose={onClose}
      footer={<>
        <button onClick={onClose}>Anuluj</button>
        <button className="primary" onClick={save} disabled={busy || !username.trim()}>Utwórz konto</button>
      </>}
    >
      {err && <div className="err">{err}</div>}
      <div><label>Login ucznia</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} /></div>
      <div><label>Hasło startowe</label>
        <div className="row">
          <input value={password} onChange={(e) => setPassword(e.target.value)} />
          <button onClick={() => setPassword(genPassword())} title="Wygeneruj">↻</button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Uczeń zaloguje się tymi danymi i zobaczy swój terminarz oraz saldo. Hasło zmieni przy pierwszym wejściu.
      </p>
    </Modal>
  );
}

function StudentForm({ onClose, onSaved }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [price, setPrice] = useState(0);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    await api.createStudent({ name: name.trim(), contact, default_price: Number(price) });
    onSaved();
  }

  return (
    <Modal
      title="Nowy uczeń"
      onClose={onClose}
      footer={<>
        <button onClick={onClose}>Anuluj</button>
        <button className="primary" onClick={save} disabled={busy || !name.trim()}>Dodaj</button>
      </>}
    >
      <div>
        <label>Imię i nazwisko</label>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="np. Jessika Kowalska" />
      </div>
      <div>
        <label>Kontakt (opcjonalnie)</label>
        <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="telefon, e-mail, rodzic..." />
      </div>
      <div>
        <label>Domyślna cena za zajęcia (PLN)</label>
        <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
    </Modal>
  );
}

function SeriesForm({ students, onClose, onSaved }) {
  const [studentId, setStudentId] = useState(students[0]?.id || "");
  const [weekday, setWeekday] = useState(0);
  const [time, setTime] = useState("16:00");
  const [price, setPrice] = useState(students[0]?.default_price || 0);
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [level, setLevel] = useState("");
  const [tutorId, setTutorId] = useState("");
  const [subjects, setSubjects] = useState([]);
  const [tutors, setTutors] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listSubjects().then(setSubjects).catch(() => {});
    api.listTutors().then(setTutors).catch(() => {});
  }, []);

  if (!students.length) {
    return (
      <Modal title="Brak uczniów" onClose={onClose}>
        <p>Najpierw dodaj ucznia.</p>
      </Modal>
    );
  }

  async function save() {
    setBusy(true);
    await api.createSeries({
      student_id: Number(studentId),
      weekday: Number(weekday),
      start_time: time + ":00",
      price: Number(price),
      start_date: startDate,
      end_date: endDate || null,
      subject_id: subjectId === "" ? null : Number(subjectId),
      level: level === "" ? null : level,
      assigned_tutor_id: tutorId === "" ? null : Number(tutorId),
    });
    onSaved();
  }

  return (
    <Modal
      title="Zajęcia cykliczne (co tydzień)"
      onClose={onClose}
      footer={<>
        <button onClick={onClose}>Anuluj</button>
        <button className="primary" onClick={save} disabled={busy}>Utwórz</button>
      </>}
    >
      <div>
        <label>Uczeń</label>
        <select value={studentId} onChange={(e) => {
          setStudentId(e.target.value);
          const s = students.find((x) => x.id === Number(e.target.value));
          if (s) setPrice(s.default_price);
        }}>
          {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="field-row">
        <div>
          <label>Przedmiot</label>
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">— brak —</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label>Poziom</label>
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">—</option>
            <option value="podstawa">podstawa</option>
            <option value="rozszerzenie">rozszerzenie</option>
          </select>
        </div>
      </div>
      <div className="field-row">
        <div>
          <label>Dzień tygodnia</label>
          <select value={weekday} onChange={(e) => setWeekday(e.target.value)}>
            {DAYS_PL.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </div>
        <div>
          <label>Godzina</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <div>
        <label>Prowadzący korepetytor</label>
        <select value={tutorId} onChange={(e) => setTutorId(e.target.value)}>
          <option value="">— nieprzypisany —</option>
          {tutors.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
        </select>
      </div>
      <div>
        <label>Cena za zajęcia (PLN)</label>
        <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
      <div className="field-row">
        <div>
          <label>Data rozpoczęcia</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label>Data zakończenia (opcj.)</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Zajęcia wygenerują się automatycznie w kalendarzu. Każde z nich możesz potem indywidualnie przesunąć lub odwołać.
      </p>
    </Modal>
  );
}

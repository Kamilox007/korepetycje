import { useState, useEffect, useCallback, useId } from "react";
import { api } from "./api";
import Modal from "./Modal";
import { DAYS_PL, DURATION_OPTIONS, fmtMoney, fmtTime } from "./dates";
import { PASSWORD_HINT, passwordError, genStartPassword } from "./password";
import { useConfirm } from "./Confirm";

export default function Students({ students, reload }) {
  const confirm = useConfirm();
  const [series, setSeries] = useState([]);
  const [showStudent, setShowStudent] = useState(false);
  const [showSeries, setShowSeries] = useState(false);
  const [accountFor, setAccountFor] = useState(null);
  const [archived, setArchived] = useState([]);
  const [showArchive, setShowArchive] = useState(false);
  const [editSeries, setEditSeries] = useState(null);
  const [editStudent, setEditStudent] = useState(null);

  // One entry point for reloading everything this view shows. Three separate
  // loaders meant that every new operation had to remember which of them to
  // call, and editing a series already missed one: the price changed in the
  // database but the table kept showing the old value until a page reload.
  const refresh = useCallback(async () => {
    const [srs, arch] = await Promise.all([
      api.listSeries(),
      api.listStudents(true),
    ]);
    setSeries(srs);
    setArchived(arch);
    reload();          // students live in the parent
  }, [reload]);

  useEffect(() => { refresh(); }, [refresh]);

  async function archiveStudent(s) {
    const ok = await confirm({
      title: "Zarchiwizować ucznia?",
      message: `${s.name} zniknie z list, terminarza i podsumowania.`,
      consequence:
        "Historia zajęć i wpłat zostaje zachowana - ucznia można przywrócić. " +
        "Konto logowania zostanie usunięte, a przyszłe nieodbyte zajęcia skasowane.",
      confirmLabel: "Archiwizuj",
      danger: false,
    });
    if (!ok) return;
    await api.archiveStudent(s.id);
    refresh();
  }

  async function restoreStudent(s) {
    await api.restoreStudent(s.id);
    refresh();
  }

  async function removeAccount(s) {
    const ok = await confirm({
      title: "Usunąć konto ucznia?",
      message: `${s.name} straci możliwość zalogowania się dotychczasowym loginem.`,
      consequence:
        "Zajęcia, wpłaty i saldo zostają bez zmian — możesz od razu założyć nowe konto z innym loginem.",
      confirmLabel: "Usuń konto",
    });
    if (!ok) return;
    await api.deleteStudentAccount(s.id);
    refresh();
  }

  async function purgeStudent(s) {
    const ok = await confirm({
      title: "Usunąć dane trwale?",
      message: `Wszystkie dane ucznia ${s.name} zostaną nieodwracalnie usunięte.`,
      consequence:
        "Znikną zajęcia, wpłaty i cała historia rozliczeń. Tej operacji nie da " +
        "się cofnąć - służy do realizacji żądania usunięcia danych (RODO).",
      requireText: s.name,
      confirmLabel: "Usuń trwale",
    });
    if (!ok) return;
    await api.purgeStudent(s.id);
    refresh();
  }

  async function removeSeries(srs) {
    const ok = await confirm({
      title: "Zakończyć serię?",
      message: "Zajęcia cykliczne przestaną się generować.",
      consequence:
        "Przyszłe, jeszcze nieodbyte terminy zostaną usunięte. " +
        "Zajęcia już odbyte i rozliczenia zostają nietknięte.",
      confirmLabel: "Zakończ serię",
    });
    if (!ok) return;
    await api.deleteSeries(srs.id);
    refresh();
  }

  function studentName(id) {
    return students.find((s) => s.id === id)?.name || "-";
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
            <thead>
              <tr><th>Imię i nazwisko</th><th>Zarchiwizowany</th><th></th></tr>
            </thead>
            <tbody>
              {archived.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 500 }}>{s.name}</td>
                  <td className="muted">{(s.archived_at || "").slice(0, 10)}</td>
                  <td className="num">
                    <button className="ghost" onClick={() => restoreStudent(s)}>Przywróć</button>
                    <button className="ghost danger" onClick={() => purgeStudent(s)}>Usuń trwale</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        {students.length === 0 ? (
          <div className="empty">
            <p>Nie masz jeszcze żadnych uczniów.</p>
            <button className="primary" onClick={() => setShowStudent(true)}>Dodaj pierwszego ucznia</button>
          </div>
        ) : (
          <table>
            <thead>
              <tr><th>Imię i nazwisko</th><th>Kontakt</th><th>Korepetytor</th><th className="num">Domyślna cena</th><th>Konto ucznia</th><th></th></tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 500 }}>{s.name}</td>
                  <td className="muted">{s.contact || "-"}</td>
                  <td>
                    {s.tutors && s.tutors.length > 0 ? (
                      <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "4px 10px" }}>
                        {s.tutors.map((t) => (
                          <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span className="legend-dot" style={{ background: t.color || "var(--ink-faint)" }} />
                            {t.display_name}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="muted">brak zajęć</span>
                    )}
                  </td>
                  <td className="num">{fmtMoney(s.default_price)}</td>
                  <td>
                    {s.has_account ? (
                      <span className="row" style={{ gap: 6, alignItems: "center" }}>
                        <span className="badge done">ma konto</span>
                        <button className="ghost" onClick={() => removeAccount(s)}>Usuń konto</button>
                      </span>
                    ) : (
                      <button className="ghost" onClick={() => setAccountFor(s)}>Załóż konto</button>
                    )}
                  </td>
                  <td className="num">
                    <button className="ghost" onClick={() => setEditStudent(s)}>Edytuj</button>
                    <button className="ghost" onClick={() => archiveStudent(s)}>Archiwizuj</button>
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
              <tr>
                <th>Uczeń</th><th>Przedmiot</th><th>Prowadzący</th>
                <th>Dzień</th><th>Godzina</th><th className="num">Cena</th><th>Od</th><th></th>
              </tr>
            </thead>
            <tbody>
              {activeSeries.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 500 }}>{studentName(s.student_id)}</td>
                  <td>
                    {s.subject_name || <span className="muted">-</span>}
                    {s.level && (
                      <span className="muted" style={{ fontSize: 12 }}>
                        {" "}· {s.level === "rozszerzenie" ? "R" : "P"}
                      </span>
                    )}
                  </td>
                  <td>
                    {s.assigned_tutor_name ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span className="legend-dot"
                              style={{ background: s.assigned_tutor_color || "var(--ink-faint)" }} />
                        {s.assigned_tutor_name}
                      </span>
                    ) : (
                      <span className="muted">nieprzypisany</span>
                    )}
                  </td>
                  <td>{DAYS_PL[s.weekday]}</td>
                  <td>{fmtTime(s.start_time)}</td>
                  <td className="num">{fmtMoney(s.price)}</td>
                  <td className="muted">{s.start_date}</td>
                  <td className="num">
                    <button className="ghost" onClick={() => setEditSeries(s)}>Edytuj</button>
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
          onSaved={() => { setShowStudent(false); refresh(); }}
        />
      )}
      {editSeries && (
        <SeriesEditForm
          series={editSeries}
          onClose={() => setEditSeries(null)}
          onSaved={() => { setEditSeries(null); refresh(); }}
        />
      )}
      {editStudent && (
        <StudentEditForm
          student={editStudent}
          onClose={() => setEditStudent(null)}
          onSaved={() => { setEditStudent(null); refresh(); }}
        />
      )}

      {showSeries && (
        <SeriesForm
          students={students}
          onClose={() => setShowSeries(false)}
          onSaved={() => { setShowSeries(false); refresh(); }}
        />
      )}
      {accountFor && (
        <AccountForm
          student={accountFor}
          onClose={() => setAccountFor(null)}
          onSaved={() => { setAccountFor(null); refresh(); }}
        />
      )}
    </div>
  );
}

// Polish diacritics have no place in a login: swap each for its plain-letter
// equivalent first, so only actual word separators (spaces, hyphens) turn
// into dots below — not every ł/ą/ż along the way.
const PL_DIACRITICS = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
  Ą: "a", Ć: "c", Ę: "e", Ł: "l", Ń: "n", Ó: "o", Ś: "s", Ź: "z", Ż: "z",
};
function toLoginSlug(name) {
  const ascii = name.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (c) => PL_DIACRITICS[c]);
  return ascii.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
}

function AccountForm({ student, onClose, onSaved }) {
  const uid = useId();
  const suggested = toLoginSlug(student.name);
  const [username, setUsername] = useState(suggested);
  const [password, setPassword] = useState(genStartPassword());
  const [created, setCreated] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const pwError = passwordError(password);

  async function save() {
    setErr("");
    if (pwError) { setErr(pwError); return; }
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
        <button className="primary" onClick={save} disabled={busy || !username.trim() || Boolean(pwError)}>Utwórz konto</button>
      </>}
    >
      {err && <div className="err">{err}</div>}
      <div><label htmlFor={`${uid}-login-ucznia-1`}>Login ucznia</label>
        <input id={`${uid}-login-ucznia-1`} value={username} onChange={(e) => setUsername(e.target.value)} /></div>
      <div><label htmlFor={`${uid}-haso-startowe-2`}>Hasło startowe</label>
        <div className="row">
          <input id={`${uid}-haso-startowe-2`} value={password} onChange={(e) => setPassword(e.target.value)} />
          <button onClick={() => setPassword(genStartPassword())} title="Wygeneruj">↻</button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{PASSWORD_HINT}</p>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Uczeń zaloguje się tymi danymi i zobaczy swój terminarz oraz saldo. Hasło zmieni przy pierwszym wejściu.
      </p>
    </Modal>
  );
}

function StudentForm({ onClose, onSaved }) {
  const uid = useId();
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
        <label htmlFor={`${uid}-imie-i-nazwisko-3`}>Imię i nazwisko</label>
        <input id={`${uid}-imie-i-nazwisko-3`} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="np. Jan Kowalski" />
      </div>
      <div>
        <label htmlFor={`${uid}-kontakt-opcjonalnie-4`}>Kontakt (opcjonalnie)</label>
        <input id={`${uid}-kontakt-opcjonalnie-4`} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="telefon, e-mail, rodzic..." />
      </div>
      <div>
        <label htmlFor={`${uid}-domyslna-cena-za-zajecia-pln-5`}>Domyślna cena za zajęcia (PLN)</label>
        <input id={`${uid}-domyslna-cena-za-zajecia-pln-5`} type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
    </Modal>
  );
}

function StudentEditForm({ student, onClose, onSaved }) {
  const uid = useId();
  const [name, setName] = useState(student.name);
  const [contact, setContact] = useState(student.contact || "");
  const [price, setPrice] = useState(student.default_price);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    await api.updateStudent(student.id, {
      name: name.trim(), contact, default_price: Number(price),
    });
    onSaved();
  }

  return (
    <Modal
      title="Edycja ucznia"
      onClose={onClose}
      footer={<>
        <button onClick={onClose}>Anuluj</button>
        <button className="primary" onClick={save} disabled={busy || !name.trim()}>Zapisz</button>
      </>}
    >
      <div>
        <label htmlFor={`${uid}-imie-i-nazwisko-edit`}>Imię i nazwisko</label>
        <input id={`${uid}-imie-i-nazwisko-edit`} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div>
        <label htmlFor={`${uid}-kontakt-edit`}>Kontakt (opcjonalnie)</label>
        <input id={`${uid}-kontakt-edit`} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="telefon, e-mail, rodzic..." />
      </div>
      <div>
        <label htmlFor={`${uid}-domyslna-cena-edit`}>Domyślna cena za zajęcia (PLN)</label>
        <input id={`${uid}-domyslna-cena-edit`} type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
    </Modal>
  );
}

function SeriesForm({ students, onClose, onSaved }) {
  const uid = useId();
  const [studentId, setStudentId] = useState(students[0]?.id || "");
  const [weekday, setWeekday] = useState(0);
  const [time, setTime] = useState("16:00");
  const [duration, setDuration] = useState(60);
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
      duration_min: Number(duration),
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
        <label htmlFor={`${uid}-uczen-6`}>Uczeń</label>
        <select id={`${uid}-uczen-6`} value={studentId} onChange={(e) => {
          setStudentId(e.target.value);
          const s = students.find((x) => x.id === Number(e.target.value));
          if (s) setPrice(s.default_price);
        }}>
          {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="field-row">
        <div>
          <label htmlFor={`${uid}-przedmiot-7`}>Przedmiot</label>
          <select id={`${uid}-przedmiot-7`} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">- brak -</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-poziom-8`}>Poziom</label>
          <select id={`${uid}-poziom-8`} value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">-</option>
            <option value="podstawa">podstawa</option>
            <option value="rozszerzenie">rozszerzenie</option>
          </select>
        </div>
      </div>
      <div className="field-row">
        <div>
          <label htmlFor={`${uid}-dzien-tygodnia-9`}>Dzień tygodnia</label>
          <select id={`${uid}-dzien-tygodnia-9`} value={weekday} onChange={(e) => setWeekday(e.target.value)}>
            {DAYS_PL.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-godzina-10`}>Godzina</label>
          <input id={`${uid}-godzina-10`} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <div>
        <label htmlFor={`${uid}-prowadzacy-korepetytor-11`}>Prowadzący korepetytor</label>
        <select id={`${uid}-prowadzacy-korepetytor-11`} value={tutorId} onChange={(e) => setTutorId(e.target.value)}>
          <option value="">- nieprzypisany -</option>
          {tutors.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
        </select>
      </div>
      <div className="field-row">
        <div>
          <label htmlFor={`${uid}-czas-trwania-15`}>Czas trwania</label>
          <select id={`${uid}-czas-trwania-15`} value={duration} onChange={(e) => setDuration(e.target.value)}>
            {DURATION_OPTIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-cena-za-zajecia-pln-12`}>Cena za zajęcia (PLN)</label>
          <input id={`${uid}-cena-za-zajecia-pln-12`} type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <div>
          <label htmlFor={`${uid}-data-rozpoczecia-13`}>Data rozpoczęcia</label>
          <input id={`${uid}-data-rozpoczecia-13`} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${uid}-data-zakonczenia-opcj-14`}>Data zakończenia (opcj.)</label>
          <input id={`${uid}-data-zakonczenia-opcj-14`} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Zajęcia wygenerują się automatycznie w kalendarzu. Każde z nich możesz potem indywidualnie przesunąć lub odwołać.
      </p>
    </Modal>
  );
}

function SeriesEditForm({ series, onClose, onSaved }) {
  const uid = useId();
  const [weekday, setWeekday] = useState(series.weekday);
  const [time, setTime] = useState(fmtTime(series.start_time));
  const [duration, setDuration] = useState(series.duration_min || 60);
  const [price, setPrice] = useState(series.price);
  const [endDate, setEndDate] = useState(series.end_date || "");
  const [subjectId, setSubjectId] = useState(series.subject_id || "");
  const [level, setLevel] = useState(series.level || "");
  const [tutorId, setTutorId] = useState(series.assigned_tutor_id || "");
  const [subjects, setSubjects] = useState([]);
  const [tutors, setTutors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.listSubjects().then(setSubjects).catch(() => {});
    api.listTutors().then(setTutors).catch(() => {});
  }, []);

  const timeChanged = time !== fmtTime(series.start_time) || weekday !== series.weekday
    || Number(duration) !== (series.duration_min || 60);

  async function save() {
    setBusy(true);
    try {
      await api.updateSeries(series.id, {
        weekday: Number(weekday),
        start_time: time.length === 5 ? `${time}:00` : time,
        duration_min: Number(duration),
        price: Number(price),
        end_date: endDate || null,
        subject_id: subjectId ? Number(subjectId) : null,
        level: level || null,
        assigned_tutor_id: tutorId ? Number(tutorId) : null,
      });
      onSaved();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Edycja serii"
      onClose={onClose}
      footer={<>
        <button onClick={onClose}>Anuluj</button>
        <button className="primary" onClick={save} disabled={busy}>Zapisz</button>
      </>}
    >
      {err && <div className="err">{err}</div>}

      <div className="field-row">
        <div>
          <label htmlFor={`${uid}-weekday`}>Dzień tygodnia</label>
          <select id={`${uid}-weekday`} value={weekday} onChange={(e) => setWeekday(e.target.value)}>
            {DAYS_PL.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-time`}>Godzina</label>
          <input id={`${uid}-time`} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>

      <div className="field-row">
        <div>
          <label htmlFor={`${uid}-subject`}>Przedmiot</label>
          <select id={`${uid}-subject`} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">-</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-level`}>Poziom</label>
          <select id={`${uid}-level`} value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">-</option>
            <option value="podstawa">Podstawa</option>
            <option value="rozszerzenie">Rozszerzenie</option>
          </select>
        </div>
      </div>

      <div className="field-row">
        <div>
          <label htmlFor={`${uid}-duration`}>Czas trwania</label>
          <select id={`${uid}-duration`} value={duration} onChange={(e) => setDuration(e.target.value)}>
            {DURATION_OPTIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-price`}>Cena (PLN)</label>
          <input id={`${uid}-price`} type="number" step="0.01" value={price}
                 onChange={(e) => setPrice(e.target.value)} />
        </div>
      </div>
      <div>
        <label htmlFor={`${uid}-end`}>Koniec serii (opcjonalnie)</label>
        <input id={`${uid}-end`} type="date" value={endDate}
               onChange={(e) => setEndDate(e.target.value)} />
      </div>

      <div>
        <label htmlFor={`${uid}-tutor`}>Prowadzący</label>
        <select id={`${uid}-tutor`} value={tutorId} onChange={(e) => setTutorId(e.target.value)}>
          <option value="">- nieprzypisany -</option>
          {tutors.map((t) => <option key={t.id} value={t.id}>{t.display_name || t.username}</option>)}
        </select>
      </div>

      <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
        Przedmiot, poziom, prowadzący i cena trafią na wszystkie przyszłe zajęcia
        z tej serii. Zajęcia już odbyte zostają bez zmian - zachowują cenę
        z momentu, w którym się odbyły.
      </p>
      {timeChanged && (
        <p className="muted" style={{ fontSize: 12 }}>
          Zmiana terminu pominie zajęcia, którym wcześniej ręcznie zmieniono datę
          lub godzinę - te zostaną tam, gdzie je przesunięto.
        </p>
      )}
    </Modal>
  );
}

import { useState, useEffect, useId } from "react";
import { usePersistentState } from "./usePersistentState";
import { api } from "./api";
import Modal from "./Modal";
import LessonCalendar from "./LessonCalendar";
import { RequestTables, DecisionModal } from "./Requests";
import {
  DAYS_PL, MONTHS_PL, parseISO, pyWeekday, fmtTime, toISODate, addDays,
} from "./dates";

export default function TutorPanel({ section = "lessons" }) {
  const [lessons, setLessons] = useState([]);
  const [avail, setAvail] = useState([]);
  const [requests, setRequests] = useState([]);
  const [editing, setEditing] = useState(null);
  const [decision, setDecision] = useState(null);
  const [err, setErr] = useState("");
  const [mode, setMode] = usePersistentState("tutor_lessons_mode", "calendar");
  const [anchor, setAnchor] = useState(new Date());
  const [view, setView] = usePersistentState(
    "tutor_cal_view",
    // A week of columns is unreadable on a phone, so start on the day view.
    // First run only; the user's later choice is stored and wins.
    typeof window !== "undefined" && window.innerWidth < 820 ? "day" : "week"
  );

  async function load() {
    try {
      // Zakres podąża za tym, co widać w kalendarzu - inaczej przejście
      // na kolejny miesiąc pokazywałoby pusty widok.
      const start = toISODate(addDays(anchor, -45));
      const end = toISODate(addDays(anchor, 75));
      const [l, a, r] = await Promise.all([
        api.tutorLessons({ start, end }),
        api.tutorAvailability(),
        api.tutorReschedule(),
      ]);
      setLessons(l); setAvail(a); setRequests(r); setErr("");
    } catch {
      setErr("Nie udało się pobrać danych.");
    }
  }
  useEffect(() => { load(); }, [anchor]);

  async function moveLessonTime(lesson, time) {
    const value = `${time}:00`;
    setLessons((prev) => prev.map((l) => (l.id === lesson.id ? { ...l, start_time: value } : l)));
    try {
      await api.tutorUpdateLesson(lesson.id, { start_time: value });
      await load();
    } catch {
      setErr("Nie udało się zmienić godziny zajęć.");
      await load();
    }
  }

  async function moveLesson(lesson, isoDate) {
    // Optimistic: the tile follows the cursor immediately, otherwise dragging
    // feels broken while the request is in flight.
    setLessons((prev) => prev.map((l) => (l.id === lesson.id ? { ...l, date: isoDate } : l)));
    try {
      await api.tutorUpdateLesson(lesson.id, { date: isoDate });
      await load();
    } catch {
      setErr("Nie udało się przenieść zajęć.");
      await load();
    }
  }

  const upcoming = lessons
    .filter((l) => !l.cancelled)
    .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));

  return (
    <div>
      <div className="page-head">
        <h1>Moje zajęcia</h1>
      </div>

      {err && <div className="err">{err}</div>}

      {section === "lessons" && (
        <div className="view-switch" style={{ marginBottom: 12 }}>
          <button className={`seg${mode === "calendar" ? " active" : ""}`} onClick={() => setMode("calendar")}>
            Kalendarz
          </button>
          <button className={`seg${mode === "list" ? " active" : ""}`} onClick={() => setMode("list")}>
            Lista
          </button>
        </div>
      )}

      {section === "lessons" && mode === "calendar" && (
        <LessonCalendar
          lessons={lessons}
          anchor={anchor}
          setAnchor={setAnchor}
          view={view}
          setView={setView}
          onPick={setEditing}
          label={(l) => l.student_name}
          onMove={moveLesson}
          onMoveTime={moveLessonTime}
        />
      )}

      {section === "lessons" && mode === "list" && (
        <div className="card">
          {upcoming.length === 0 ? (
            <div className="empty"><p>Nie masz przypisanych zajęć.</p></div>
          ) : (
            <table>
              <thead><tr><th>Data</th><th>Godzina</th><th>Uczeń</th><th>Przedmiot</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {upcoming.map((l) => {
                  const d = parseISO(l.date);
                  return (
                    <tr key={l.id}>
                      <td>{DAYS_PL[pyWeekday(d)]}, {d.getDate()} {MONTHS_PL[d.getMonth()]}</td>
                      <td>{fmtTime(l.start_time)} {l.rescheduled ? "↻" : ""}</td>
                      <td style={{ fontWeight: 500 }}>{l.student_name}</td>
                      <td>{l.subject_name ? `${l.subject_name}${l.level ? ` (${l.level})` : ""}` : "-"}</td>
                      <td>{l.completed ? <span className="badge done">odbyte</span> : <span className="badge plan">zaplanowane</span>}</td>
                      <td className="num"><button className="ghost" onClick={() => setEditing(l)}>Edytuj</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {section === "requests" && (
        <RequestTables requests={requests} onDecide={setDecision} />
      )}

      {section === "availability" && (
        <Availability avail={avail} reload={load} />
      )}

      {editing && (
        <EditTutorLesson
          lesson={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}

      {decision && (
        <DecisionModal
          tutorView
          decision={decision}
          onClose={() => setDecision(null)}
          onDone={async () => { setDecision(null); await load(); }}
        />
      )}
    </div>
  );
}

function EditTutorLesson({ lesson, onClose, onSaved }) {
  const uid = useId();
  const [date, setDate] = useState(lesson.date);
  const [time, setTime] = useState(fmtTime(lesson.start_time));
  const [completed, setCompleted] = useState(lesson.completed);
  const [note, setNote] = useState(lesson.note || "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    await api.tutorUpdateLesson(lesson.id, {
      date, start_time: time + ":00", completed, note,
    });
    onSaved();
  }

  return (
    <Modal
      title={`Zajęcia - ${lesson.student_name}`}
      onClose={onClose}
      footer={<>
        <button onClick={onClose}>Anuluj</button>
        <button className="primary" onClick={save} disabled={busy}>Zapisz</button>
      </>}
    >
      <div className="field-row">
        <div><label htmlFor={`${uid}-data-2`}>Data</label><input id={`${uid}-data-2`} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label htmlFor={`${uid}-godzina-3`}>Godzina</label><input id={`${uid}-godzina-3`} type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
      </div>
      <div className="toggle-line">
        <input type="checkbox" id="done" checked={completed} onChange={(e) => setCompleted(e.target.checked)} />
        <label htmlFor="done" style={{ margin: 0 }}>Zajęcia się odbyły</label>
      </div>
      <div><label htmlFor={`${uid}-notatka-4`}>Notatka</label><textarea id={`${uid}-notatka-4`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Jako korepetytor możesz zmienić termin i oznaczyć odbycie. Cena i rozliczenia są po stronie administracji.
      </p>
    </Modal>
  );
}

function Availability({ avail, reload }) {
  const uid = useId();
  const [weekday, setWeekday] = useState(0);
  const [start, setStart] = useState("14:00");
  const [end, setEnd] = useState("20:00");
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    await api.tutorAddAvailability({ weekday: Number(weekday), start_time: start + ":00", end_time: end + ":00" });
    setBusy(false);
    reload();
  }
  async function remove(id) {
    await api.tutorDeleteAvailability(id);
    reload();
  }

  const byDay = DAYS_PL.map((_, i) => avail.filter((a) => a.weekday === i));

  return (
    <div>
      <div className="card" style={{ padding: "16px 20px", marginBottom: 20 }}>
        <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label htmlFor={`${uid}-dzien-5`}>Dzień</label>
            <select id={`${uid}-dzien-5`} value={weekday} onChange={(e) => setWeekday(e.target.value)}>
              {DAYS_PL.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <div><label htmlFor={`${uid}-od-6`}>Od</label><input id={`${uid}-od-6`} type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><label htmlFor={`${uid}-do-7`}>Do</label><input id={`${uid}-do-7`} type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          <button className="primary" onClick={add} disabled={busy}>Dodaj</button>
        </div>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Dzień</th><th>Dostępne godziny</th></tr></thead>
          <tbody>
            {DAYS_PL.map((d, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 500 }}>{d}</td>
                <td>
                  {byDay[i].length === 0
                    ? <span className="muted">-</span>
                    : byDay[i].map((a) => (
                      <span key={a.id} className="badge plan" style={{ marginRight: 6 }}>
                        {fmtTime(a.start_time)}–{fmtTime(a.end_time)}
                        <span style={{ cursor: "pointer", marginLeft: 4 }} onClick={() => remove(a.id)}>✕</span>
                      </span>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        Te godziny będą podpowiadane uczniom przy prośbach o zmianę terminu.
      </p>
    </div>
  );
}

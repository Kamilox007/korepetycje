import { useState, useEffect, useId } from "react";
import { usePersistentState } from "./usePersistentState";
import { api } from "./api";
import LessonCalendar from "./LessonCalendar";
import TransferQR from "./TransferQR";
import Modal from "./Modal";
import {
  DAYS_PL, MONTHS_PL, parseISO, pyWeekday, fmtMoney, fmtTime, toISODate, addDays,
} from "./dates";

export default function StudentPanel({ section = "lessons" }) {
  // Which section is shown comes from the URL now; the sidebar links switch it.
  const tab = section;
  const [lessons, setLessons] = useState([]);
  const [summary, setSummary] = useState(null);
  const [payments, setPayments] = useState([]);
  const [requests, setRequests] = useState([]);
  const [reqFor, setReqFor] = useState(null);
  const [err, setErr] = useState("");
  const [mode, setMode] = usePersistentState("student_lessons_mode", "calendar");
  const [anchor, setAnchor] = useState(new Date());
  const [view, setView] = usePersistentState(
    "student_cal_view",
    // A week of columns is unreadable on a phone, so start on the day view.
    // First run only; the user's later choice is stored and wins.
    typeof window !== "undefined" && window.innerWidth < 820 ? "day" : "week"
  );

  async function loadAll() {
    try {
      // Zakres podąża za tym, co widać w kalendarzu - inaczej przejście
      // na kolejny miesiąc pokazywałoby pusty widok.
      const start = toISODate(addDays(anchor, -45));
      const end = toISODate(addDays(anchor, 75));
      const [l, s, p, r] = await Promise.all([
        api.myLessons({ start, end }),
        api.mySummary(),
        api.myPayments(),
        api.myReschedule(),
      ]);
      setLessons(l); setSummary(s); setPayments(p); setRequests(r);
      setErr("");
    } catch (e) {
      setErr("Nie udało się pobrać danych.");
    }
  }
  useEffect(() => { loadAll(); }, [anchor]);

  const today = new Date();
  const upcoming = lessons
    .filter((l) => !l.cancelled && parseISO(l.date) >= new Date(today.toDateString()))
    .slice(0, 30);

  function reqStatus(lessonId) {
    const r = requests.find((x) => x.lesson_id === lessonId && x.status === "pending");
    return r ? "pending" : null;
  }

  return (
    <div>
      <div className="page-head">
        <h1>Moje zajęcia</h1>
      </div>

      {err && <div className="err">{err}</div>}

      {summary && (
        <div className="metrics">
          <div className="metric"><div className="label">Odbyte zajęcia</div><div className="value">{summary.lessons_completed}</div></div>
          <div className="metric"><div className="label">Należność</div><div className="value">{fmtMoney(summary.amount_due)}</div></div>
          <div className="metric"><div className="label">Wpłacono</div><div className="value">{fmtMoney(summary.amount_paid)}</div></div>
          <div className="metric"><div className="label">Saldo</div>
            <div className={`value ${summary.balance >= 0 ? "pos" : "neg"}`}>{fmtMoney(summary.balance)}</div></div>
        </div>
      )}

      {tab === "lessons" && (
        <div className="view-switch" style={{ marginBottom: 12 }}>
          <button className={`seg${mode === "calendar" ? " active" : ""}`} onClick={() => setMode("calendar")}>
            Kalendarz
          </button>
          <button className={`seg${mode === "list" ? " active" : ""}`} onClick={() => setMode("list")}>
            Lista
          </button>
        </div>
      )}

      {tab === "lessons" && mode === "calendar" && (
        <LessonCalendar
          lessons={lessons}
          anchor={anchor}
          setAnchor={setAnchor}
          view={view}
          setView={setView}
          onPick={(l) => { if (!l.completed && !l.cancelled) setReqFor(l); }}
          label={(l) => l.subject_name || "Zajęcia"}
        />
      )}

      {tab === "lessons" && mode === "list" && (
        <div className="card">
          {upcoming.length === 0 ? (
            <div className="empty"><p>Brak nadchodzących zajęć.</p></div>
          ) : (
            <table>
              <thead><tr><th>Data</th><th>Godzina</th><th>Przedmiot</th><th>Prowadzący</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {upcoming.map((l) => {
                  const d = parseISO(l.date);
                  const pending = reqStatus(l.id);
                  return (
                    <tr key={l.id}>
                      <td>{DAYS_PL[pyWeekday(d)]}, {d.getDate()} {MONTHS_PL[d.getMonth()]}</td>
                      <td>{fmtTime(l.start_time)} {l.rescheduled ? "↻" : ""}</td>
                      <td>{l.subject_name ? `${l.subject_name}${l.level ? ` (${l.level})` : ""}` : "-"}</td>
                      <td className="muted">{l.assigned_tutor_name || "-"}</td>
                      <td>
                        {l.completed
                          ? <span className="badge done">odbyte</span>
                          : <span className="badge plan">zaplanowane</span>}
                      </td>
                      <td className="num">
                        {pending
                          ? <span className="badge resched">prośba wysłana</span>
                          : !l.completed && <button className="ghost" onClick={() => setReqFor(l)}>Poproś o zmianę</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "payments" && <TransferQR />}

      {tab === "payments" && (
        <div className="card">
          {payments.length === 0 ? (
            <div className="empty"><p>Brak zarejestrowanych wpłat.</p></div>
          ) : (
            <table>
              <thead><tr><th>Data</th><th>Od kogo</th><th>Notatka</th><th className="num">Kwota</th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="muted">{p.date}</td>
                    <td>{p.payer || "-"}</td>
                    <td className="muted">{p.note || ""}</td>
                    <td className="num" style={{ fontWeight: 600, color: "var(--done)" }}>{fmtMoney(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "requests" && (
        <div className="card">
          {requests.length === 0 ? (
            <div className="empty"><p>Nie złożyłeś jeszcze żadnej prośby o przesunięcie.</p></div>
          ) : (
            <table>
              <thead><tr><th>Zajęcia</th><th>Proponowany termin</th><th>Status</th><th>Odpowiedź</th></tr></thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td>{r.lesson_date} {fmtTime(r.lesson_time)}</td>
                    <td>{r.proposed_date || "-"} {fmtTime(r.proposed_time)}</td>
                    <td>
                      {r.status === "pending" && <span className="badge resched">oczekuje</span>}
                      {r.status === "approved" && <span className="badge done">zaakceptowana</span>}
                      {r.status === "rejected" && <span className="badge due">odrzucona</span>}
                    </td>
                    <td className="muted">{r.response || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {reqFor && (
        <RequestForm
          lesson={reqFor}
          onClose={() => setReqFor(null)}
          onSent={async () => { setReqFor(null); await loadAll(); }}
        />
      )}
    </div>
  );
}

function RequestForm({ lesson, onClose, onSent }) {
  const uid = useId();
  const [slots, setSlots] = useState(null); // null = loading, {has_tutor, days, tutor_name}
  const [selectedDay, setSelectedDay] = useState("");
  const [time, setTime] = useState("");
  const [manualDate, setManualDate] = useState(lesson.date);
  const [manualTime, setManualTime] = useState(fmtTime(lesson.start_time));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.myLessonSlots(lesson.id).then(setSlots).catch(() => setSlots({ has_tutor: false, days: [] }));
  }, [lesson.id]);

  const usePicker = slots && slots.has_tutor && slots.days.length > 0;
  const dayObj = usePicker ? slots.days.find((d) => d.date === selectedDay) : null;

  // start times precomputed by the backend (they account for lesson duration)
  function timeOptions(day) {
    return day ? day.slots : [];
  }

  async function send() {
    setBusy(true);
    const d = usePicker ? selectedDay : manualDate;
    const t = usePicker ? time : manualTime;
    await api.requestReschedule({
      lesson_id: lesson.id,
      proposed_date: d,
      proposed_time: t + ":00",
      message,
    });
    onSent();
  }

  const canSend = usePicker ? (selectedDay && time) : (manualDate && manualTime);

  return (
    <Modal
      title="Prośba o przesunięcie zajęć"
      onClose={onClose}
      footer={<>
        <button onClick={onClose}>Anuluj</button>
        <button className="primary" onClick={send} disabled={busy || !canSend}>Wyślij prośbę</button>
      </>}
    >
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Prośba trafi do korepetytora i administracji. Termin zmieni się dopiero po zatwierdzeniu.
      </p>

      {slots === null && <p className="muted">Ładowanie dostępnych terminów…</p>}

      {usePicker && (
        <>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Dostępne terminy korepetytora{slots.tutor_name ? ` (${slots.tutor_name})` : ""} na najbliższe 2 tygodnie:
          </p>
          <div>
            <label htmlFor={`${uid}-wybierz-dzien-1`}>Wybierz dzień</label>
            <select id={`${uid}-wybierz-dzien-1`} value={selectedDay} onChange={(e) => { setSelectedDay(e.target.value); setTime(""); }}>
              <option value="">- wybierz -</option>
              {slots.days.map((d) => {
                const dt = parseISO(d.date);
                const win = d.windows.map((w) => `${w.start}–${w.end}`).join(", ");
                return (
                  <option key={d.date} value={d.date}>
                    {DAYS_PL[pyWeekday(dt)]} {dt.getDate()} {MONTHS_PL[dt.getMonth()]} ({win})
                  </option>
                );
              })}
            </select>
          </div>
          {dayObj && (
            <div>
              <label htmlFor={`${uid}-wybierz-godzine-2`}>Wybierz godzinę</label>
              <select id={`${uid}-wybierz-godzine-2`} value={time} onChange={(e) => setTime(e.target.value)}>
                <option value="">- wybierz -</option>
                {timeOptions(dayObj).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
        </>
      )}

      {slots && !usePicker && (
        <>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            {slots.has_tutor === false && slots.tutor_name
              ? "Korepetytor nie ustawił jeszcze dostępnych godzin - wpisz proponowany termin ręcznie."
              : "Wpisz proponowany termin ręcznie."}
          </p>
          <div className="field-row">
            <div><label htmlFor={`${uid}-proponowana-data-3`}>Proponowana data</label><input id={`${uid}-proponowana-data-3`} type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} /></div>
            <div><label htmlFor={`${uid}-proponowana-godzina-4`}>Proponowana godzina</label><input id={`${uid}-proponowana-godzina-4`} type="time" value={manualTime} onChange={(e) => setManualTime(e.target.value)} /></div>
          </div>
        </>
      )}

      <div><label htmlFor={`${uid}-wiadomosc-opcjonalnie-5`}>Wiadomość (opcjonalnie)</label>
        <textarea id={`${uid}-wiadomosc-opcjonalnie-5`} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="np. powód zmiany" /></div>
    </Modal>
  );
}

import { useState, useEffect, useCallback, useId } from "react";
import { api } from "./api";
import Modal from "./Modal";
import { usePersistentState } from "./usePersistentState";
import { TUTOR_COLORS, UNASSIGNED_COLOR, tint } from "./colors";
import {
  DAYS_SHORT, DAYS_PL, MONTHS_PL, DURATION_OPTIONS, startOfWeek, addDays, toISODate, parseISO,
  sameDay, fmtMoney, fmtTime, monthGrid, pyWeekday,
} from "./dates";
import { useConfirm } from "./Confirm";

const VIEWS = [
  { id: "day", label: "Dzień" },
  { id: "week", label: "Tydzień" },
  { id: "month", label: "Miesiąc" },
];

// Lesson tile styling based on the assigned tutor's colour.
// Completed and cancelled lessons keep their own styling (we return null).
function lessonStyle(l) {
  if (l.completed || l.cancelled) return null;
  const c = l.assigned_tutor_color;
  if (!c) {
    // no tutor assigned: neutral background, dashed border
    return {
      background: "var(--surface-2)",
      borderLeftColor: UNASSIGNED_COLOR,
      border: `1px dashed ${UNASSIGNED_COLOR}`,
    };
  }
  return { background: tint(c, 0.85), borderLeftColor: c };
}

export default function Calendar({ students, onChanged }) {
  // A week view is unreadable on a phone, so start on the day view. This only
  // applies to the very first run; the user's later choice is stored and wins.
  const [view, setView] = usePersistentState(
    "cal_view",
    typeof window !== "undefined" && window.innerWidth < 820 ? "day" : "week"
  );
  const [anchorISO, setAnchorISO] = usePersistentState("cal_anchor", toISODate(new Date()));
  const anchor = parseISO(anchorISO);
  const setAnchor = (d) => setAnchorISO(toISODate(d instanceof Date ? d : parseISO(d)));
  const [lessons, setLessons] = useState([]);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(null);
  const [tutors, setTutors] = useState([]);
  const [subjects, setSubjects] = useState([]);
  // Session-only, not persisted: an empty calendar after reload because a
  // filter was silently still on would be more confusing than useful.
  const [subjectFilter, setSubjectFilter] = useState("");
  const [tutorFilter, setTutorFilter] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    api.listTutors().then(setTutors).catch(() => {});
    api.listSubjects().then(setSubjects).catch(() => {});
  }, []);

  let rangeStart, rangeEnd;
  if (view === "day") {
    rangeStart = new Date(anchor); rangeStart.setHours(0, 0, 0, 0);
    rangeEnd = new Date(rangeStart);
  } else if (view === "week") {
    rangeStart = startOfWeek(anchor);
    rangeEnd = addDays(rangeStart, 6);
  } else {
    const grid = monthGrid(anchor);
    rangeStart = grid[0];
    rangeEnd = grid[grid.length - 1];
  }
  const startISO = toISODate(rangeStart);
  const endISO = toISODate(rangeEnd);

  const load = useCallback(async () => {
    try {
      const data = await api.listLessons({ start: startISO, end: endISO });
      setLessons(data);
      setErr("");
    } catch {
      setErr("Nie udało się pobrać zajęć. Czy backend działa na :8000?");
    }
  }, [startISO, endISO]);

  useEffect(() => { load(); }, [load]);

  const today = new Date();

  function lessonsFor(day) {
    return lessons
      .filter((l) => sameDay(parseISO(l.date), day))
      .filter((l) => !subjectFilter || String(l.subject_id) === subjectFilter)
      .filter((l) => !tutorFilter || String(l.assigned_tutor_id) === tutorFilter)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  async function afterChange() {
    await load();
    onChanged?.();
  }

  function navigate(dir) {
    if (view === "day") setAnchor(addDays(anchor, dir));
    else if (view === "week") setAnchor(addDays(anchor, dir * 7));
    else setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
  }

  let rangeLabel;
  if (view === "day") {
    rangeLabel = `${DAYS_PL[pyWeekday(anchor)]}, ${anchor.getDate()} ${MONTHS_PL[anchor.getMonth()]} ${anchor.getFullYear()}`;
  } else if (view === "week") {
    const ws = startOfWeek(anchor), we = addDays(ws, 6);
    rangeLabel = `${ws.getDate()} ${MONTHS_PL[ws.getMonth()]} – ${we.getDate()} ${MONTHS_PL[we.getMonth()]} ${we.getFullYear()}`;
  } else {
    rangeLabel = `${MONTHS_PL[anchor.getMonth()]} ${anchor.getFullYear()}`;
  }

  return (
    <div>
      <div className="page-head">
        <h1>Kalendarz</h1>
        <div className="row">
          <div className="view-switch">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                className={`seg${view === v.id ? " active" : ""}`}
                onClick={() => setView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button onClick={() => setAdding(toISODate(today))} className="primary">
            + Zajęcia jednorazowe
          </button>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      <div className="cal-head">
        <button onClick={() => navigate(-1)}>←</button>
        <button onClick={() => setAnchor(new Date())}>Dziś</button>
        <button onClick={() => navigate(1)}>→</button>
        <span className="range">{rangeLabel}</span>
        <div className="spacer" />
        <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}
                aria-label="Filtruj po przedmiocie" style={{ width: "auto" }}>
          <option value="">Wszystkie przedmioty</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={tutorFilter} onChange={(e) => setTutorFilter(e.target.value)}
                aria-label="Filtruj po korepetytorze" style={{ width: "auto" }}>
          <option value="">Wszyscy korepetytorzy</option>
          {tutors.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
        </select>
      </div>

      {tutors.length > 0 && (
        <div className="legend">
          {tutors.map((t) => (
            <span key={t.id} className="legend-item">
              <span className="legend-dot" style={{ background: t.color || "transparent", borderStyle: t.color ? "solid" : "dashed" }} />
              {t.display_name}
            </span>
          ))}
          <span className="legend-item">
            <span className="legend-dot" style={{ background: "var(--surface-2)", borderStyle: "dashed", borderColor: UNASSIGNED_COLOR }} />
            nieprzypisane
          </span>
        </div>
      )}

      {view === "day" && (
        <DayView
          day={anchor}
          lessons={lessonsFor(anchor)}
          onPick={setEditing}
          onAdd={(time) => setAdding({ date: toISODate(anchor), time })}
          onDropTime={async (lesson, newTime) => {
            await api.updateLesson(lesson.id, { start_time: newTime + ":00" });
            await afterChange();
          }}
        />
      )}
      {view === "week" && (
        <WeekView
          weekStart={startOfWeek(anchor)}
          today={today}
          lessonsFor={lessonsFor}
          onPick={setEditing}
          onAdd={(iso) => setAdding(iso)}
          onDropDay={(lesson, isoDate) => {
            // dropped on another day: open the editor with the new date
            if (lesson.date === isoDate) return;
            setEditing({ ...lesson, date: isoDate, _movedTo: isoDate });
          }}
        />
      )}
      {view === "month" && (
        <MonthView
          anchor={anchor}
          today={today}
          lessonsFor={lessonsFor}
          onPick={setEditing}
          onPickDay={(d) => { setAnchor(d); setView("day"); }}
          onDropDay={(lesson, isoDate) => {
            if (lesson.date === isoDate) return;
            setEditing({ ...lesson, date: isoDate, _movedTo: isoDate });
          }}
        />
      )}

      {editing && (
        <EditLesson
          lesson={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await afterChange(); }}
        />
      )}
      {adding && (
        <AddLesson
          date={typeof adding === "string" ? adding : adding.date}
          time={typeof adding === "object" ? adding.time : undefined}
          students={students}
          onClose={() => setAdding(null)}
          onSaved={async () => { setAdding(null); await afterChange(); }}
        />
      )}
    </div>
  );
}

const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;
const HOUR_PX = 56;

// Lays lessons that overlap in time out into side-by-side columns.
// Returns a map of id -> { col, cols }: column index and columns in the group.
function computeColumns(lessons) {
  const toMin = (t) => {
    const [h, m] = (t || "0:0").slice(0, 5).split(":").map(Number);
    return h * 60 + m;
  };
  const items = lessons
    .map((l) => ({
      id: l.id,
      start: toMin(l.start_time),
      end: toMin(l.start_time) + (l.duration_min || 60),
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const result = {};
  let group = [];
  let groupEnd = -1;

  const flush = () => {
    if (!group.length) return;
    const colEnds = [];
    for (const it of group) {
      let placed = false;
      for (let c = 0; c < colEnds.length; c++) {
        if (it.start >= colEnds[c]) { it.col = c; colEnds[c] = it.end; placed = true; break; }
      }
      if (!placed) { it.col = colEnds.length; colEnds.push(it.end); }
    }
    const cols = colEnds.length;
    for (const it of group) result[it.id] = { col: it.col, cols };
    group = [];
    groupEnd = -1;
  };

  for (const it of items) {
    if (group.length && it.start >= groupEnd) flush();
    group.push(it);
    groupEnd = Math.max(groupEnd, it.end);
  }
  flush();
  return result;
}

function DayView({ day, lessons, onPick, onAdd, onDropTime }) {
  const hours = [];
  for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) hours.push(h);

  const [drag, setDrag] = useState(null); // { lesson, previewTop, previewTime }

  function topFor(timeStr) {
    const [h, m] = timeStr.split(":").map(Number);
    return (h - DAY_START_HOUR) * HOUR_PX + (m / 60) * HOUR_PX;
  }
  function heightFor(min) {
    return Math.max(22, (min / 60) * HOUR_PX);
  }
  // Y position -> time rounded to 15 minutes, clamped to the day
  function timeFromY(y, durationMin) {
    let totalMin = (y / HOUR_PX) * 60 + DAY_START_HOUR * 60;
    totalMin = Math.round(totalMin / 15) * 15;
    const dayStart = DAY_START_HOUR * 60;
    const dayEnd = (DAY_END_HOUR + 1) * 60;
    totalMin = Math.max(dayStart, Math.min(totalMin, dayEnd - (durationMin || 60)));
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function onColDragOver(e) {
    if (!drag) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const t = timeFromY(y, drag.lesson.duration_min);
    setDrag((d) => d ? { ...d, previewTime: t, previewTop: topFor(t) } : d);
  }
  async function onColDrop(e) {
    if (!drag) return;
    e.preventDefault();
    const t = drag.previewTime;
    const lesson = drag.lesson;
    setDrag(null);
    if (t && t !== fmtTime(lesson.start_time)) {
      await onDropTime(lesson, t);
    }
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="day-grid">
        <div className="hours-col">
          {hours.map((h) => (
            <div key={h} className="hour-row" style={{ height: HOUR_PX }}>
              <span className="hour-label">{String(h).padStart(2, "0")}:00</span>
            </div>
          ))}
        </div>
        <div
          className="events-col"
          style={{ height: (DAY_END_HOUR - DAY_START_HOUR + 1) * HOUR_PX }}
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            const rel = e.nativeEvent.offsetY;
            const h = DAY_START_HOUR + Math.floor(rel / HOUR_PX);
            onAdd(`${String(Math.min(h, DAY_END_HOUR)).padStart(2, "0")}:00`);
          }}
          onDragOver={onColDragOver}
          onDrop={onColDrop}
          onDragLeave={(e) => { if (e.target === e.currentTarget) setDrag((d) => d ? { ...d, previewTime: null } : d); }}
        >
          {hours.map((h) => (
            <div key={h} className="hour-line" style={{ top: (h - DAY_START_HOUR) * HOUR_PX }} />
          ))}
          {/* cień-podgląd miejsca upuszczenia */}
          {drag && drag.previewTime && (
            <div
              className="drop-shadow"
              style={{ top: drag.previewTop, height: heightFor(drag.lesson.duration_min) }}
            >
              {drag.previewTime}
            </div>
          )}
          {(() => {
            const layout = computeColumns(lessons);
            const GAP = 3; // px between columns
            return lessons.map((l) => {
              const top = topFor(fmtTime(l.start_time));
              const dragging = drag && drag.lesson.id === l.id;
              const lay = layout[l.id] || { col: 0, cols: 1 };
              // width and left offset in percent, accounting for column gaps
              const widthPct = 100 / lay.cols;
              const leftStyle = `calc(${lay.col * widthPct}% + 8px)`;
              const widthStyle = `calc(${widthPct}% - ${8 + GAP}px)`;
              return (
                <div
                  key={l.id}
                  className={`event${l.completed ? " done" : ""}${l.cancelled ? " cancelled" : ""}${dragging ? " dragging" : ""}`}
                  style={{ top, height: heightFor(l.duration_min), left: leftStyle, width: widthStyle, ...(lessonStyle(l) || {}) }}
                  draggable={!l.completed && !l.cancelled}
                  onDragStart={() => setDrag({ lesson: l, previewTime: fmtTime(l.start_time), previewTop: top })}
                  onDragEnd={() => setDrag(null)}
                  onClick={(e) => { e.stopPropagation(); onPick(l); }}
                >
                  <span className="t">{fmtTime(l.start_time)} {l.rescheduled ? "↻" : ""}</span>
                  <span className="n">{l.student_name}</span>
                  {l.assigned_tutor_name && <span className="subj">{l.assigned_tutor_name}</span>}
                  {l.subject_name && <span className="subj">{l.subject_name}{l.level ? ` · ${l.level === "rozszerzenie" ? "R" : "P"}` : ""}</span>}
                  {!l.cancelled && <span className="p">{fmtMoney(l.price)}</span>}
                </div>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}

function WeekView({ weekStart, today, lessonsFor, onPick, onAdd, onDropDay }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const [dragId, setDragId] = useState(null);
  const [overDay, setOverDay] = useState(null);
  return (
    <div className="week">
      {days.map((day, i) => {
        const dl = lessonsFor(day);
        const iso = toISODate(day);
        return (
          <div
            key={i}
            className={`day-col${sameDay(day, today) ? " today" : ""}${overDay === iso ? " drop-over" : ""}`}
            onDragOver={(e) => { if (dragId != null) { e.preventDefault(); setOverDay(iso); } }}
            onDragLeave={(e) => { if (e.target === e.currentTarget) setOverDay(null); }}
            onDrop={(e) => {
              e.preventDefault();
              const l = dl.find((x) => x.id === dragId) || window.__dragLesson;
              setOverDay(null); setDragId(null);
              if (window.__dragLesson) onDropDay(window.__dragLesson, iso);
            }}
          >
            <div className="day-head">
              <span className="day-name">{DAYS_SHORT[i]}</span>
              <span className="day-num">{day.getDate()}</span>
            </div>
            {dl.map((l) => (
              <div
                key={l.id}
                className={`lesson-chip${l.completed ? " done" : ""}${l.cancelled ? " cancelled" : ""}`}
                style={lessonStyle(l) || undefined}
                draggable={!l.completed && !l.cancelled}
                onDragStart={() => { setDragId(l.id); window.__dragLesson = l; }}
                onDragEnd={() => { setDragId(null); setOverDay(null); window.__dragLesson = null; }}
                onClick={() => onPick(l)}
                title={l.assigned_tutor_name || (l.rescheduled ? "Termin zmieniony" : "")}
              >
                <div className="t">{fmtTime(l.start_time)} {l.rescheduled ? "↻" : ""}</div>
                <div className="n">{l.student_name}</div>
                {l.assigned_tutor_name && <div className="subj">{l.assigned_tutor_name}</div>}
                {l.subject_name && <div className="subj">{l.subject_name}{l.level ? ` · ${l.level === "rozszerzenie" ? "R" : "P"}` : ""}</div>}
              </div>
            ))}
            <button className="ghost add-cell" onClick={() => onAdd(toISODate(day))} title="Dodaj zajęcia">+</button>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({ anchor, today, lessonsFor, onPick, onPickDay, onDropDay }) {
  const cells = monthGrid(anchor);
  const month = anchor.getMonth();
  const [overIso, setOverIso] = useState(null);
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="month-names">
        {DAYS_SHORT.map((d) => <div key={d} className="month-name">{d}</div>)}
      </div>
      <div className="month-grid">
        {cells.map((day, i) => {
          const dl = lessonsFor(day);
          const out = day.getMonth() !== month;
          const shown = dl.slice(0, 3);
          const extra = dl.length - shown.length;
          const iso = toISODate(day);
          return (
            <div
              key={i}
              className={`month-cell${out ? " out" : ""}${sameDay(day, today) ? " today" : ""}${overIso === iso ? " drop-over" : ""}`}
              onClick={() => onPickDay(day)}
              onDragOver={(e) => { if (window.__dragLesson) { e.preventDefault(); setOverIso(iso); } }}
              onDragLeave={(e) => { if (e.target === e.currentTarget) setOverIso(null); }}
              onDrop={(e) => {
                e.preventDefault();
                setOverIso(null);
                if (window.__dragLesson) onDropDay(window.__dragLesson, iso);
              }}
            >
              <div className="month-day-num">{day.getDate()}</div>
              {shown.map((l) => (
                <div
                  key={l.id}
                  className={`mini-chip${l.completed ? " done" : ""}${l.cancelled ? " cancelled" : ""}`}
                  style={lessonStyle(l) || undefined}
                  draggable={!l.completed && !l.cancelled}
                  onDragStart={(e) => { e.stopPropagation(); window.__dragLesson = l; }}
                  onDragEnd={() => { window.__dragLesson = null; setOverIso(null); }}
                  onClick={(e) => { e.stopPropagation(); onPick(l); }}
                  title={`${fmtTime(l.start_time)} ${l.student_name}${l.assigned_tutor_name ? " — " + l.assigned_tutor_name : ""}`}
                >
                  {fmtTime(l.start_time)} {l.student_name}
                </div>
              ))}
              {extra > 0 && <div className="more">+{extra} więcej</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EditLesson({ lesson, onClose, onSaved }) {
  const uid = useId();
  const confirm = useConfirm();
  const [date, setDate] = useState(lesson.date);
  const [time, setTime] = useState(fmtTime(lesson.start_time));
  const [duration, setDuration] = useState(lesson.duration_min || 60);
  const [price, setPrice] = useState(lesson.price);
  const [completed, setCompleted] = useState(lesson.completed);
  const [cancelled, setCancelled] = useState(lesson.cancelled);
  const [note, setNote] = useState(lesson.note || "");
  const [tutorId, setTutorId] = useState(lesson.assigned_tutor_id || "");
  const [tutors, setTutors] = useState([]);
  const [subjectId, setSubjectId] = useState(lesson.subject_id || "");
  const [level, setLevel] = useState(lesson.level || "");
  const [subjects, setSubjects] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listTutors().then(setTutors).catch(() => {});
    api.listSubjects().then(setSubjects).catch(() => {});
  }, []);

  async function save() {
    setBusy(true);
    await api.updateLesson(lesson.id, {
      date, start_time: time + ":00", duration_min: Number(duration), price: Number(price), completed, cancelled, note,
      assigned_tutor_id: tutorId === "" ? null : Number(tutorId),
      subject_id: subjectId === "" ? null : Number(subjectId),
      level: level === "" ? null : level,
    });
    onSaved();
  }
  async function remove() {
    const ok = await confirm({
      title: "Usunąć zajęcia?",
      message: `${lesson.student_name} — ${lesson.date}, godz. ${String(lesson.start_time).slice(0, 5)}.`,
      consequence:
        "Zajęcia znikną z terminarza i przestaną być liczone do salda. " +
        "Jeśli chcesz zachować ślad, zamiast usuwać oznacz je jako odwołane.",
      confirmLabel: "Usuń zajęcia",
    });
    if (!ok) return;
    setBusy(true);
    await api.deleteLesson(lesson.id);
    onSaved();
  }

  return (
    <Modal
      title={`Zajęcia — ${lesson.student_name}`}
      onClose={onClose}
      footer={<>
        <button className="danger" onClick={remove} disabled={busy}>Usuń</button>
        <div className="spacer" />
        <button onClick={onClose}>Anuluj</button>
        <button className="primary" onClick={save} disabled={busy}>Zapisz</button>
      </>}
    >
      {lesson._movedTo && (
        <div className="info-banner">
          Przeniesiono na nowy dzień — sprawdź lub dostosuj godzinę i zapisz.
        </div>
      )}
      {lesson.series_id && (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Z serii cyklicznej. Zmiana terminu dotyczy tylko tego wystąpienia.
        </p>
      )}
      <div className="field-row">
        <div><label htmlFor={`${uid}-data-1`}>Data</label><input id={`${uid}-data-1`} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label htmlFor={`${uid}-godzina-2`}>Godzina</label><input id={`${uid}-godzina-2`} type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
      </div>
      <div className="field-row">
        <div>
          <label htmlFor={`${uid}-czas-trwania`}>Czas trwania</label>
          <select id={`${uid}-czas-trwania`} value={duration} onChange={(e) => setDuration(e.target.value)}>
            {DURATION_OPTIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </div>
        <div><label htmlFor={`${uid}-cena-pln-3`}>Cena (PLN)</label><input id={`${uid}-cena-pln-3`} type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
      </div>
      <div className="field-row">
        <div>
          <label htmlFor={`${uid}-przedmiot-4`}>Przedmiot</label>
          <select id={`${uid}-przedmiot-4`} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">— brak —</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-poziom-5`}>Poziom</label>
          <select id={`${uid}-poziom-5`} value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">—</option>
            <option value="podstawa">podstawa</option>
            <option value="rozszerzenie">rozszerzenie</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={`${uid}-prowadzacy-korepetytor-6`}>Prowadzący korepetytor</label>
        <select id={`${uid}-prowadzacy-korepetytor-6`} value={tutorId} onChange={(e) => setTutorId(e.target.value)}>
          <option value="">— nieprzypisany —</option>
          {tutors.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
        </select>
      </div>
      <div className="toggle-line">
        <input type="checkbox" id="done" checked={completed}
          onChange={(e) => { setCompleted(e.target.checked); if (e.target.checked) setCancelled(false); }} />
        <label htmlFor="done" style={{ margin: 0 }}>Zajęcia się odbyły (wejdzie do rozliczeń)</label>
      </div>
      <div className="toggle-line">
        <input type="checkbox" id="canc" checked={cancelled}
          onChange={(e) => { setCancelled(e.target.checked); if (e.target.checked) setCompleted(false); }} />
        <label htmlFor="canc" style={{ margin: 0 }}>Odwołane</label>
      </div>
      <div><label htmlFor={`${uid}-notatka-7`}>Notatka</label><textarea id={`${uid}-notatka-7`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
    </Modal>
  );
}

function AddLesson({ date, time: initialTime, students, onClose, onSaved }) {
  const uid = useId();
  const [studentId, setStudentId] = useState(students[0]?.id || "");
  const [d, setD] = useState(date);
  const [time, setTime] = useState(initialTime || "16:00");
  const [duration, setDuration] = useState(60);
  const [price, setPrice] = useState(students[0]?.default_price || 0);
  const [busy, setBusy] = useState(false);

  if (!students.length) {
    return <Modal title="Brak uczniów" onClose={onClose}><p>Najpierw dodaj ucznia w zakładce „Uczniowie".</p></Modal>;
  }

  async function save() {
    setBusy(true);
    await api.createLesson({
      student_id: Number(studentId), date: d, start_time: time + ":00",
      duration_min: Number(duration), price: Number(price),
    });
    onSaved();
  }

  return (
    <Modal
      title="Nowe zajęcia jednorazowe"
      onClose={onClose}
      footer={<>
        <button onClick={onClose}>Anuluj</button>
        <button className="primary" onClick={save} disabled={busy}>Dodaj</button>
      </>}
    >
      <div>
        <label htmlFor={`${uid}-uczen-8`}>Uczeń</label>
        <select id={`${uid}-uczen-8`} value={studentId} onChange={(e) => {
          setStudentId(e.target.value);
          const s = students.find((x) => x.id === Number(e.target.value));
          if (s) setPrice(s.default_price);
        }}>
          {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="field-row">
        <div><label htmlFor={`${uid}-data-9`}>Data</label><input id={`${uid}-data-9`} type="date" value={d} onChange={(e) => setD(e.target.value)} /></div>
        <div><label htmlFor={`${uid}-godzina-10`}>Godzina</label><input id={`${uid}-godzina-10`} type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
      </div>
      <div className="field-row">
        <div>
          <label htmlFor={`${uid}-czas-trwania-add`}>Czas trwania</label>
          <select id={`${uid}-czas-trwania-add`} value={duration} onChange={(e) => setDuration(e.target.value)}>
            {DURATION_OPTIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </div>
        <div><label htmlFor={`${uid}-cena-pln-11`}>Cena (PLN)</label><input id={`${uid}-cena-pln-11`} type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

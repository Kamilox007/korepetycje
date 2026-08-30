import { useState } from "react";
import {
  DAYS_SHORT, MONTHS_PL, startOfWeek, addDays, toISODate, parseISO,
  sameDay, fmtTime, fmtMoney, monthGrid, DAYS_PL, MONTHS_PL as _M,
} from "./dates";

/**
 * Read-only calendar for the tutor and student panels.
 *
 * Deliberately separate from Calendar.jsx: that one carries drag-and-drop,
 * inline creation and staff-only editing, none of which belongs here. Sharing it
 * would mean threading a dozen "can I" flags through every view.
 *
 * The CSS classes are the same, so both calendars look identical.
 */
// Same grid as the staff calendar, so both look and scroll alike.
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;
const HOUR_PX = 56;

export default function LessonCalendar({
  lessons,
  anchor,
  setAnchor,
  view,
  setView,
  onPick,
  label,
  // Optional. When given, lessons can be dragged onto another day and this is
  // called with (lesson, isoDate). Left out for the student panel, where moving
  // a lesson needs the tutor's approval rather than a drag.
  onMove,
  // Optional, day view only: called with (lesson, "HH:MM") when a lesson is
  // dragged to another hour. Separate from onMove, which changes the date.
  onMoveTime,
}) {
  const today = new Date();

  function lessonsFor(day) {
    const iso = toISODate(day);
    return lessons
      .filter((l) => l.date === iso)
      .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  }

  function navigate(dir) {
    if (view === "month") {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
    } else {
      setAnchor(addDays(anchor, view === "day" ? dir : dir * 7));
    }
  }

  const weekStart = startOfWeek(anchor);
  const rangeLabel =
    view === "day"
      ? `${DAYS_PL[(anchor.getDay() + 6) % 7]}, ${anchor.getDate()} ${_M[anchor.getMonth()]}`
      : view === "month"
      ? `${MONTHS_PL[anchor.getMonth()]} ${anchor.getFullYear()}`.replace(/^./, (c) => c.toUpperCase())
      : `${weekStart.getDate()}–${addDays(weekStart, 6).getDate()} ${MONTHS_PL[addDays(weekStart, 6).getMonth()]}`;

  return (
    <div>
      <div className="cal-head">
        <button onClick={() => navigate(-1)}>←</button>
        <button onClick={() => setAnchor(new Date())}>Dziś</button>
        <button onClick={() => navigate(1)}>→</button>
        <span className="range">{rangeLabel}</span>
        <div className="spacer" />
        <div className="view-switch">
          <button
            className={view === "day" ? "primary" : ""}
            onClick={() => setView("day")}
          >
            Dzień
          </button>
          <button
            className={view === "week" ? "primary" : ""}
            onClick={() => setView("week")}
          >
            Tydzień
          </button>
          <button
            className={view === "month" ? "primary" : ""}
            onClick={() => setView("month")}
          >
            Miesiąc
          </button>
        </div>
      </div>

      {view === "day" ? (
        <DayView day={anchor} lessons={lessonsFor(anchor)} onPick={onPick}
                 label={label} onMoveTime={onMoveTime} />
      ) : view === "month" ? (
        <MonthView anchor={anchor} today={today} lessonsFor={lessonsFor}
                   onPick={onPick} label={label} onMove={onMove} />
      ) : (
        <WeekView weekStart={weekStart} today={today} lessonsFor={lessonsFor}
                  onPick={onPick} label={label} onMove={onMove} />
      )}
    </div>
  );
}

function chipClass(l) {
  return `mini-chip${l.completed ? " done" : ""}${l.cancelled ? " cancelled" : ""}`;
}

/** A lesson tile. Draggable only when moving is allowed and the lesson is still
 *  open: a completed or cancelled one has nothing left to reschedule. */
function Chip({ lesson, label, onPick, onMove, style }) {
  const movable = Boolean(onMove) && !lesson.completed && !lesson.cancelled;
  return (
    <div
      className={chipClass(lesson)}
      style={style}
      draggable={movable}
      onDragStart={(e) => { e.stopPropagation(); window.__dragLesson = lesson; }}
      onDragEnd={() => { window.__dragLesson = null; }}
      onClick={(e) => { e.stopPropagation(); onPick && onPick(lesson); }}
      title={`${fmtTime(lesson.start_time)} ${label(lesson)}`}
    >
      {fmtTime(lesson.start_time)} {label(lesson)}
    </div>
  );
}

/** Drop handling shared by the month cell and the week column. */
function dropProps(iso, onMove, setOver) {
  if (!onMove) return {};
  return {
    onDragOver: (e) => { if (window.__dragLesson) { e.preventDefault(); setOver(iso); } },
    onDragLeave: (e) => { if (e.target === e.currentTarget) setOver(null); },
    onDrop: (e) => {
      e.preventDefault();
      setOver(null);
      const l = window.__dragLesson;
      window.__dragLesson = null;
      // Dropping onto the same day is a no-op, not an update.
      if (l && l.date !== iso) onMove(l, iso);
    },
  };
}

function MonthView({ anchor, today, lessonsFor, onPick, label, onMove }) {
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
              {...dropProps(iso, onMove, setOverIso)}
            >
              <div className="month-day-num">{day.getDate()}</div>
              {shown.map((l) => (
                <Chip key={l.id} lesson={l} label={label} onPick={onPick} onMove={onMove} />
              ))}
              {extra > 0 && <div className="more">+{extra} więcej</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ weekStart, today, lessonsFor, onPick, label, onMove }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const [overIso, setOverIso] = useState(null);
  return (
    <div className="week">
      {days.map((day, i) => {
        const dl = lessonsFor(day);
        const iso = toISODate(day);
        return (
          <div
            key={i}
            className={`card day-col${sameDay(day, today) ? " today" : ""}${overIso === iso ? " drop-over" : ""}`}
            style={{ padding: 10 }}
            {...dropProps(iso, onMove, setOverIso)}
          >
            <div className="day-head" style={{ marginBottom: 8 }}>
              <span className="day-name">{DAYS_SHORT[i]}</span>{" "}
              <span className="day-num">{day.getDate()}</span>
            </div>
            {dl.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>-</div>
            ) : (
              dl.map((l) => (
                <Chip key={l.id} lesson={l} label={label} onPick={onPick}
                      onMove={onMove} style={{ marginBottom: 4 }} />
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Hour grid for a single day. Read-only: rescheduling by time belongs in the
 *  edit dialog, where the tutor can also see the price and the subject. */
function DayView({ day, lessons, onPick, label, onMoveTime }) {
  const hours = [];
  for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) hours.push(h);

  const [drag, setDrag] = useState(null); // { lesson, previewTop, previewTime }

  function topFor(timeStr) {
    const [h, m] = String(timeStr).split(":").map(Number);
    return (h - DAY_START_HOUR) * HOUR_PX + (m / 60) * HOUR_PX;
  }
  function heightFor(min) {
    return Math.max(22, ((min || 60) / 60) * HOUR_PX);
  }
  // Y position -> time rounded to 15 minutes, clamped to the day
  function timeFromY(y, durationMin) {
    let total = (y / HOUR_PX) * 60 + DAY_START_HOUR * 60;
    total = Math.round(total / 15) * 15;
    const dayStart = DAY_START_HOUR * 60;
    const dayEnd = (DAY_END_HOUR + 1) * 60;
    total = Math.max(dayStart, Math.min(total, dayEnd - (durationMin || 60)));
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
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
          onDragOver={(e) => {
            if (!drag) return;
            e.preventDefault();
            const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
            const t = timeFromY(y, drag.lesson.duration_min);
            setDrag((d) => (d ? { ...d, previewTime: t, previewTop: topFor(t) } : d));
          }}
          onDragLeave={(e) => {
            if (e.target === e.currentTarget) setDrag((d) => (d ? { ...d, previewTime: null } : d));
          }}
          onDrop={(e) => {
            if (!drag) return;
            e.preventDefault();
            const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
            const t = timeFromY(y, drag.lesson.duration_min);
            const lesson = drag.lesson;
            setDrag(null);
            if (t && t !== fmtTime(lesson.start_time)) onMoveTime(lesson, t);
          }}
        >
          {hours.map((h) => (
            <div key={h} className="hour-line" style={{ top: (h - DAY_START_HOUR) * HOUR_PX }} />
          ))}
          {/* preview of where the lesson would land */}
          {drag && drag.previewTime && (
            <div className="drop-shadow"
                 style={{ top: drag.previewTop, height: heightFor(drag.lesson.duration_min) }}>
              {drag.previewTime}
            </div>
          )}
          {lessons.map((l) => {
            const movable = Boolean(onMoveTime) && !l.completed && !l.cancelled;
            return (
            <div
              key={l.id}
              className={`event${l.completed ? " done" : ""}${l.cancelled ? " cancelled" : ""}${drag && drag.lesson.id === l.id ? " dragging" : ""}`}
              style={{
                top: topFor(fmtTime(l.start_time)),
                height: heightFor(l.duration_min),
                left: 8,
                width: "calc(100% - 16px)",
              }}
              draggable={movable}
              onDragStart={() => setDrag({
                lesson: l,
                previewTime: fmtTime(l.start_time),
                previewTop: topFor(fmtTime(l.start_time)),
              })}
              onDragEnd={() => setDrag(null)}
              onClick={(e) => { e.stopPropagation(); onPick && onPick(l); }}
            >
              <span className="t">{fmtTime(l.start_time)} {l.rescheduled ? "↻" : ""}</span>
              <span className="n">{label(l)}</span>
              {l.subject_name && (
                <span className="subj">
                  {l.subject_name}{l.level ? ` · ${l.level === "rozszerzenie" ? "R" : "P"}` : ""}
                </span>
              )}
              {!l.cancelled && l.price != null && <span className="p">{fmtMoney(l.price)}</span>}
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

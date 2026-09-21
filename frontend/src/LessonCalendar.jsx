import { useState } from "react";
import {
  DAYS_SHORT, DAYS_PL, MONTHS_PL, startOfWeek, addDays, toISODate,
  sameDay, fmtTime, monthGrid, pyWeekday,
} from "./dates";
import { colorForStudent, tint } from "./colors";
import DayGrid from "./DayGrid";

/**
 * Calendar for the tutor and student panels.
 *
 * Separate from Calendar.jsx, which also carries inline creation, filters and
 * the staff edit dialog. What both share - the hour grid of the day view with
 * its drag-to-another-hour handling - lives in DayGrid.jsx; the week and month
 * views are small enough that each calendar keeps its own, and the CSS classes
 * are the same, so both look identical.
 */

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
      ? `${DAYS_PL[pyWeekday(anchor)]}, ${anchor.getDate()} ${MONTHS_PL[anchor.getMonth()]}`
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
        <DayGrid lessons={lessonsFor(anchor)} onPick={onPick} label={label}
                 tileStyle={lessonStyle} onMoveTime={onMoveTime} />
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

// Tile colour by student, so a tutor with several students on one day can
// tell them apart at a glance. Completed/cancelled lessons keep their own
// styling (green/greyed-out), so they return null here.
function lessonStyle(l) {
  if (l.completed || l.cancelled) return null;
  const c = colorForStudent(l.student_id);
  if (!c) return null;
  return { background: tint(c, 0.85), borderLeftColor: c };
}

/** A lesson tile. Draggable only when moving is allowed and the lesson is still
 *  open: a completed or cancelled one has nothing left to reschedule. */
function Chip({ lesson, label, onPick, onMove, style }) {
  const movable = Boolean(onMove) && !lesson.completed && !lesson.cancelled;
  return (
    <div
      className={chipClass(lesson)}
      style={{ ...(lessonStyle(lesson) || {}), ...style }}
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

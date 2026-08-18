import { useState } from "react";
import {
  DAYS_SHORT, MONTHS_PL, startOfWeek, addDays, toISODate, parseISO,
  sameDay, fmtTime, monthGrid,
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
export default function LessonCalendar({
  lessons,
  anchor,
  setAnchor,
  view,
  setView,
  onPick,
  label,
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
      setAnchor(addDays(anchor, dir * 7));
    }
  }

  const weekStart = startOfWeek(anchor);
  const rangeLabel =
    view === "month"
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

      {view === "month" ? (
        <MonthView anchor={anchor} today={today} lessonsFor={lessonsFor} onPick={onPick} label={label} />
      ) : (
        <WeekView weekStart={weekStart} today={today} lessonsFor={lessonsFor} onPick={onPick} label={label} />
      )}
    </div>
  );
}

function chipClass(l) {
  return `mini-chip${l.completed ? " done" : ""}${l.cancelled ? " cancelled" : ""}`;
}

function MonthView({ anchor, today, lessonsFor, onPick, label }) {
  const cells = monthGrid(anchor);
  const month = anchor.getMonth();
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
          return (
            <div
              key={i}
              className={`month-cell${out ? " out" : ""}${sameDay(day, today) ? " today" : ""}`}
            >
              <div className="month-day-num">{day.getDate()}</div>
              {shown.map((l) => (
                <div
                  key={l.id}
                  className={chipClass(l)}
                  onClick={() => onPick && onPick(l)}
                  title={`${fmtTime(l.start_time)} ${label(l)}`}
                >
                  {fmtTime(l.start_time)} {label(l)}
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

function WeekView({ weekStart, today, lessonsFor, onPick, label }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <div className="week">
      {days.map((day, i) => {
        const dl = lessonsFor(day);
        return (
          <div key={i} className={`card day-col${sameDay(day, today) ? " today" : ""}`} style={{ padding: 10 }}>
            <div className="day-head" style={{ marginBottom: 8 }}>
              <span className="day-name">{DAYS_SHORT[i]}</span>{" "}
              <span className="day-num">{day.getDate()}</span>
            </div>
            {dl.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>—</div>
            ) : (
              dl.map((l) => (
                <div
                  key={l.id}
                  className={chipClass(l)}
                  style={{ marginBottom: 4 }}
                  onClick={() => onPick && onPick(l)}
                  title={`${fmtTime(l.start_time)} ${label(l)}`}
                >
                  {fmtTime(l.start_time)} {label(l)}
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

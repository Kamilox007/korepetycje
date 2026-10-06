import { useState } from "react";
import { fmtMoney, fmtTime } from "./dates";

// One grid for the staff calendar and the tutor/student one, so both look
// and scroll alike.
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;
const HOUR_PX = 56;

function topFor(timeStr) {
  const [h, m] = String(timeStr).split(":").map(Number);
  return (h - DAY_START_HOUR) * HOUR_PX + (m / 60) * HOUR_PX;
}

// Shaved a few px off the bottom so back-to-back lessons (one ending right
// where the next starts) show a sliver of the column background between
// them, instead of two tiles flush against each other reading as one.
function heightFor(min) {
  return Math.max(22, ((min || 60) / 60) * HOUR_PX) - 4;
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

// Lays lessons that overlap in time out into side-by-side columns.
// Returns a map of id -> { col, cols }: column index and columns in the group.
export function computeColumns(lessons) {
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

const GAP = 3; // px between side-by-side columns

/**
 * Hour grid for one day with lesson tiles positioned by time.
 *
 * Owns the placement and the drag-to-another-hour interaction (preview shadow,
 * 15-minute rounding, clamping to the day). What a tile says and how it is
 * coloured is the caller's business: `label(l)` is the main line, `extra(l)`
 * an optional line under it, `tileStyle(l)` the colour override.
 *
 * - `onMoveTime(lesson, "HH:MM")`: optional; without it nothing is draggable.
 * - `onAdd("HH:00")`: optional; a click on an empty spot of the column.
 * - `columns`: lay overlapping lessons side by side. Wanted in the staff
 *   calendar, where two tutors may teach at once; off for a single person's
 *   day, where an overlap is rare and reads better stacked.
 */
export default function DayGrid({
  lessons, onPick, onAdd, onMoveTime, label, extra, tileStyle, columns = false,
}) {
  const hours = [];
  for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) hours.push(h);

  const [drag, setDrag] = useState(null); // { lesson, previewTop, previewTime }
  const layout = columns ? computeColumns(lessons) : {};

  function placement(l) {
    const lay = layout[l.id] || { col: 0, cols: 1 };
    // width and left offset in percent, accounting for column gaps
    const widthPct = 100 / lay.cols;
    return {
      left: `calc(${lay.col * widthPct}% + 8px)`,
      width: `calc(${widthPct}% - ${8 + (lay.cols > 1 ? GAP : 8)}px)`,
    };
  }

  function timeAt(e) {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    return timeFromY(y, drag.lesson.duration_min);
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
          onClick={onAdd && ((e) => {
            if (e.target !== e.currentTarget) return;
            const h = DAY_START_HOUR + Math.floor(e.nativeEvent.offsetY / HOUR_PX);
            onAdd(`${String(Math.min(h, DAY_END_HOUR)).padStart(2, "0")}:00`);
          })}
          onDragOver={(e) => {
            if (!drag) return;
            e.preventDefault();
            const t = timeAt(e);
            setDrag((d) => (d ? { ...d, previewTime: t, previewTop: topFor(t) } : d));
          }}
          onDragLeave={(e) => {
            if (e.target === e.currentTarget) setDrag((d) => (d ? { ...d, previewTime: null } : d));
          }}
          onDrop={(e) => {
            if (!drag) return;
            e.preventDefault();
            const t = timeAt(e);
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
            const dragging = drag && drag.lesson.id === l.id;
            return (
              <div
                key={l.id}
                className={`event${l.completed ? " done" : ""}${l.cancelled ? " cancelled" : ""}${dragging ? " dragging" : ""}`}
                style={{
                  top: topFor(fmtTime(l.start_time)),
                  height: heightFor(l.duration_min),
                  ...placement(l),
                  ...(tileStyle?.(l) || {}),
                }}
                draggable={movable}
                onDragStart={() => setDrag({
                  lesson: l,
                  previewTime: fmtTime(l.start_time),
                  previewTop: topFor(fmtTime(l.start_time)),
                })}
                onDragEnd={() => setDrag(null)}
                onClick={(e) => { e.stopPropagation(); onPick?.(l); }}
              >
                <span className="t">{fmtTime(l.start_time)} {l.rescheduled ? "↻" : ""}</span>
                <span className="n">{label(l)}</span>
                {extra?.(l)}
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

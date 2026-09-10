import { TUTOR_COLORS } from "./colors";

/** Swatch grid drawn from the shared tutor palette. `value` may be null/""
 *  (no color chosen); pass `allowNone` to add a "default" swatch that clears it. */
export default function ColorPicker({ value, onChange, allowNone = false }) {
  return (
    <div className="color-grid">
      {allowNone && (
        <button
          type="button"
          title="Domyślny"
          className={`color-swatch none${!value ? " selected" : ""}`}
          onClick={() => onChange(null)}
        />
      )}
      {TUTOR_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`color-swatch${value === c ? " selected" : ""}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

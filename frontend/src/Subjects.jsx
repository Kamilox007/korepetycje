import { useState, useEffect } from "react";
import { api } from "./api";

const PRESET_COLORS = ["#378ADD", "#1D9E75", "#D85A30", "#D4537E", "#7F77DD", "#BA7517", "#888780"];

export default function Subjects() {
  const [subjects, setSubjects] = useState([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setSubjects(await api.listSubjects()); setErr(""); }
    catch { setErr("Nie udało się pobrać przedmiotów."); }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!name.trim()) return;
    setErr(""); setBusy(true);
    try {
      await api.createSubject({ name: name.trim(), color });
      setName("");
      load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function remove(s) {
    if (!confirm(`Usunąć przedmiot „${s.name}"? Zostanie odłączony od istniejących zajęć (zajęcia zostaną).`)) return;
    await api.deleteSubject(s.id);
    load();
  }

  return (
    <div>
      <div className="page-head"><h1>Przedmioty</h1></div>
      {err && <div className="err">{err}</div>}

      <div className="card" style={{ padding: "16px 20px", marginBottom: 20 }}>
        <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Nazwa przedmiotu</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()} placeholder="np. Matematyka" />
          </div>
          <div>
            <label>Kolor</label>
            <div className="row" style={{ gap: 6 }}>
              {PRESET_COLORS.map((c) => (
                <span key={c} onClick={() => setColor(c)}
                  style={{
                    width: 22, height: 22, borderRadius: 6, background: c, cursor: "pointer",
                    border: color === c ? "2px solid var(--ink)" : "2px solid transparent",
                  }} />
              ))}
            </div>
          </div>
          <button className="primary" onClick={add} disabled={busy || !name.trim()}>Dodaj</button>
        </div>
      </div>

      <div className="card">
        {subjects.length === 0 ? (
          <div className="empty"><p>Nie zdefiniowano jeszcze przedmiotów.</p></div>
        ) : (
          <table>
            <thead><tr><th>Przedmiot</th><th></th></tr></thead>
            <tbody>
              {subjects.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span style={{
                      display: "inline-block", width: 12, height: 12, borderRadius: 3,
                      background: s.color || "var(--ink-faint)", marginRight: 8, verticalAlign: "middle",
                    }} />
                    <span style={{ fontWeight: 500 }}>{s.name}</span>
                  </td>
                  <td className="num"><button className="ghost danger" onClick={() => remove(s)}>Usuń</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

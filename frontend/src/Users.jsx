import { useState, useEffect } from "react";
import { api } from "./api";
import Modal from "./Modal";
import { TUTOR_COLORS } from "./colors";
import { useConfirm } from "./Confirm";

const ROLE_LABEL = { admin: "Administrator", secretary: "Sekretariat", tutor: "Korepetytor", student: "Uczeń" };

export default function Users({ myRole }) {
  const confirm = useConfirm();
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [colorFor, setColorFor] = useState(null);
  const [err, setErr] = useState("");

  async function load() {
    try { setUsers(await api.listUsers()); setErr(""); }
    catch { setErr("Nie udało się pobrać użytkowników."); }
  }
  useEffect(() => { load(); }, []);

  async function remove(u) {
    const ok = await confirm({
      title: "Usunąć konto?",
      message: `Konto ${u.display_name || u.username} (${u.username}) zostanie usunięte.`,
      consequence:
        "Użytkownik natychmiast straci dostęp do aplikacji. " +
        "Dane ucznia powiązane z kontem zostają.",
      confirmLabel: "Usuń konto",
    });
    if (!ok) return;
    try { await api.deleteUser(u.id); load(); }
    catch (e) { alert(e.message); }
  }

  const staff = users.filter((u) => u.role === "admin" || u.role === "secretary");
  const tutors = users.filter((u) => u.role === "tutor");
  const students = users.filter((u) => u.role === "student");

  return (
    <div>
      <div className="page-head">
        <h1>Użytkownicy</h1>
        <button className="primary" onClick={() => setShowForm(true)}>+ Nowy użytkownik</button>
      </div>
      {err && <div className="err">{err}</div>}

      {myRole === "admin" && (
        <Section title="Administracja" users={staff} onRemove={remove} />
      )}
      <Section title="Korepetytorzy" users={tutors} onRemove={remove} showColor onColor={setColorFor} />
      <Section title="Uczniowie (konta)" users={students} onRemove={remove} />

      {showForm && (
        <UserForm myRole={myRole} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />
      )}
      {colorFor && (
        <ColorModal user={colorFor} onClose={() => setColorFor(null)} onSaved={() => { setColorFor(null); load(); }} />
      )}
    </div>
  );
}

function Section({ title, users, onRemove, showColor, onColor }) {
  return (
    <>
      <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>{title}</h2>
      <div className="card" style={{ marginBottom: 24 }}>
        {users.length === 0 ? (
          <div className="empty"><p>Brak.</p></div>
        ) : (
          <table>
            <thead><tr>
              {showColor && <th style={{ width: 50 }}>Kolor</th>}
              <th>Nazwa</th><th>Login</th><th>Rola</th><th></th>
            </tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  {showColor && (
                    <td>
                      <button
                        className="color-dot"
                        style={{ background: u.color || "transparent", borderStyle: u.color ? "solid" : "dashed" }}
                        onClick={() => onColor(u)}
                        title="Zmień kolor"
                      />
                    </td>
                  )}
                  <td style={{ fontWeight: 500 }}>{u.display_name || "—"}</td>
                  <td className="muted">{u.username}</td>
                  <td>{ROLE_LABEL[u.role] || u.role}</td>
                  <td className="num"><button className="ghost danger" onClick={() => onRemove(u)}>Usuń</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function ColorPicker({ value, onChange }) {
  return (
    <div className="color-grid">
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

function ColorModal({ user, onClose, onSaved }) {
  const [color, setColor] = useState(user.color || TUTOR_COLORS[0]);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    await api.updateUser(user.id, { color });
    onSaved();
  }
  return (
    <Modal title={`Kolor — ${user.display_name || user.username}`} onClose={onClose}
      footer={<>
        <button onClick={onClose}>Anuluj</button>
        <button className="primary" onClick={save} disabled={busy}>Zapisz</button>
      </>}>
      <label>Wybierz kolor w kalendarzu</label>
      <ColorPicker value={color} onChange={setColor} />
    </Modal>
  );
}

function UserForm({ myRole, onClose, onSaved }) {
  const [role, setRole] = useState("tutor");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(gen());
  const [color, setColor] = useState(TUTOR_COLORS[0]);
  const [created, setCreated] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function gen() { return Math.random().toString(36).slice(2, 8) + Math.floor(Math.random() * 90 + 10); }

  const roleOptions = myRole === "admin"
    ? [["tutor", "Korepetytor"], ["secretary", "Sekretariat"]]
    : [["tutor", "Korepetytor"]];

  async function save() {
    setErr("");
    if (!username.trim()) { setErr("Podaj login."); return; }
    setBusy(true);
    try {
      const res = await api.createUser({
        username: username.trim(), password, role,
        display_name: displayName.trim() || username.trim(),
        color: role === "tutor" ? color : null,
      });
      setCreated(res);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  if (created) {
    return (
      <Modal title="Konto utworzone" onClose={onSaved}
        footer={<button className="primary" onClick={onSaved}>Gotowe</button>}>
        <p style={{ margin: 0 }}>Przekaż dane logowania. Hasło widać tylko teraz:</p>
        <div className="cred-box">
          <div><span className="muted">Login:</span> <strong>{created.username}</strong></div>
          <div><span className="muted">Hasło:</span> <strong>{created.password}</strong></div>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>Użytkownik zmieni hasło przy pierwszym logowaniu.</p>
      </Modal>
    );
  }

  return (
    <Modal title="Nowy użytkownik" onClose={onClose}
      footer={<>
        <button onClick={onClose}>Anuluj</button>
        <button className="primary" onClick={save} disabled={busy || !username.trim()}>Utwórz</button>
      </>}>
      {err && <div className="err">{err}</div>}
      <div>
        <label>Rola</label>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {roleOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div><label>Imię i nazwisko</label>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="np. Jan Kowalski" /></div>
      <div><label>Login</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} /></div>
      <div><label>Hasło startowe</label>
        <div className="row">
          <input value={password} onChange={(e) => setPassword(e.target.value)} />
          <button onClick={() => setPassword(gen())} title="Wygeneruj">↻</button>
        </div>
      </div>
      {role === "tutor" && (
        <div>
          <label>Kolor w kalendarzu</label>
          <ColorPicker value={color} onChange={setColor} />
        </div>
      )}
    </Modal>
  );
}

import { useState, useEffect, useId } from "react";
import { api } from "./api";
import Modal from "./Modal";
import { TUTOR_COLORS } from "./colors";
import { PASSWORD_HINT, passwordError, genStartPassword } from "./password";
import { useConfirm } from "./Confirm";

const ROLE_LABEL = { admin: "Administrator", secretary: "Sekretariat", tutor: "Korepetytor", student: "Uczeń" };

export default function Users({ myRole }) {
  const confirm = useConfirm();
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [colorFor, setColorFor] = useState(null);
  const [err, setErr] = useState("");
  const [resetResult, setResetResult] = useState(null);

  async function load() {
    try { setUsers(await api.listUsers()); setErr(""); }
    catch { setErr("Nie udało się pobrać użytkowników."); }
  }
  useEffect(() => { load(); }, []);

  async function resetPassword(u) {
    const ok = await confirm({
      title: "Zresetować hasło?",
      message: `${u.display_name || u.username} (${u.username}) dostanie nowe hasło startowe.`,
      consequence:
        "Dotychczasowe hasło przestanie działać, a wszystkie sesje tego konta " +
        "zostaną zamknięte. Przy pierwszym logowaniu użytkownik ustawi własne hasło.",
      confirmLabel: "Resetuj hasło",
      danger: false,
    });
    if (!ok) return;
    try { setResetResult(await api.resetUserPassword(u.id)); }
    catch (e) { alert(e.message); }
  }

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
        <Section title="Administracja" users={staff} onRemove={remove} onReset={resetPassword} showColor onColor={setColorFor} />
      )}
      <Section title="Korepetytorzy" users={tutors} onRemove={remove} onReset={resetPassword} showColor onColor={setColorFor} />
      <Section title="Uczniowie (konta)" users={students} onRemove={remove} onReset={resetPassword} />

      {resetResult && (
        <Modal
          title="Nowe hasło startowe"
          onClose={() => setResetResult(null)}
          footer={<button className="primary" onClick={() => setResetResult(null)}>Gotowe</button>}
        >
          <p>
            Przekaż je użytkownikowi <strong>{resetResult.display_name || resetResult.username}</strong>.
            Hasło pokazujemy tylko teraz - nigdzie nie jest przechowywane w czytelnej postaci.
          </p>
          <div className="card" style={{ padding: 12, marginTop: 10 }}>
            <div className="muted" style={{ fontSize: 12 }}>Login</div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{resetResult.username}</div>
            <div className="muted" style={{ fontSize: 12 }}>Hasło startowe</div>
            <code style={{ fontSize: 16 }}>{resetResult.password}</code>
          </div>
        </Modal>
      )}

      {showForm && (
        <UserForm myRole={myRole} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />
      )}
      {colorFor && (
        <ColorModal user={colorFor} myRole={myRole} onClose={() => setColorFor(null)} onSaved={() => { setColorFor(null); load(); }} />
      )}
    </div>
  );
}

function Section({ title, users, onRemove, onReset, showColor, onColor }) {
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
                  <td style={{ fontWeight: 500 }}>{u.display_name || "-"}</td>
                  <td className="muted">{u.username}</td>
                  <td>{ROLE_LABEL[u.role] || u.role}</td>
                  <td className="num">
                    {showColor && <button className="ghost" onClick={() => onColor(u)}>Edytuj</button>}
                    <button className="ghost" onClick={() => onReset(u)}>Resetuj hasło</button>
                    <button className="ghost danger" onClick={() => onRemove(u)}>Usuń</button>
                  </td>
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

function ColorModal({ user, myRole, onClose, onSaved }) {
  const uid = useId();
  const [displayName, setDisplayName] = useState(user.display_name || "");
  const [color, setColor] = useState(user.color || TUTOR_COLORS[0]);
  const [account, setAccount] = useState(user.bank_account || "");
  const [phone, setPhone] = useState(user.blik_phone || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!displayName.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const data = { display_name: displayName.trim(), color };
      // Only an admin may touch the account/phone, so anyone else sends
      // colour alone and the backend never has to reject the request.
      if (myRole === "admin") {
        data.bank_account = account.trim() || null;
        data.blik_phone = phone.trim() || null;
      }
      await api.updateUser(user.id, data);
      onSaved();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Ustawienia - ${user.display_name || user.username}`} onClose={onClose}
      footer={<>
        <button onClick={onClose}>Anuluj</button>
        <button className="primary" onClick={save} disabled={busy || !displayName.trim()}>Zapisz</button>
      </>}>
      {err && <div className="err">{err}</div>}

      <div>
        <label htmlFor={`${uid}-nazwa`}>Imię i nazwisko</label>
        <input id={`${uid}-nazwa`} value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus />
      </div>

      <label>Kolor w kalendarzu</label>
      <ColorPicker value={color} onChange={setColor} />

      {myRole === "admin" && (
        <div style={{ marginTop: 18 }}>
          <label htmlFor={`${uid}-account`}>Numer rachunku</label>
          <input
            id={`${uid}-account`}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder="26 cyfr, można wkleić ze spacjami"
          />
          <p className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
            Na ten rachunek uczniowie tego korepetytora wysyłają przelewy - kod QR
            w ich panelu wskazuje właśnie tutaj. Suma kontrolna jest sprawdzana
            przy zapisie.
          </p>
        </div>
      )}

      {myRole === "admin" && (
        <div style={{ marginTop: 18 }}>
          <label htmlFor={`${uid}-phone`}>Numer telefonu do BLIK</label>
          <input
            id={`${uid}-phone`}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="9 cyfr, opcjonalnie"
          />
          <p className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
            Pokazywany uczniom jako alternatywa dla przelewu — do ręcznego wysłania
            BLIK-iem, obok kodu QR.
          </p>
        </div>
      )}
    </Modal>
  );
}

function UserForm({ myRole, onClose, onSaved }) {
  const uid = useId();
  const [role, setRole] = useState("tutor");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(genStartPassword());
  const [color, setColor] = useState(TUTOR_COLORS[0]);
  const [created, setCreated] = useState(null);
  const [err, setErr] = useState("");
  const [resetResult, setResetResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const roleOptions = myRole === "admin"
    ? [["tutor", "Korepetytor"], ["secretary", "Sekretariat"]]
    : [["tutor", "Korepetytor"]];

  const pwError = passwordError(password);

  async function save() {
    setErr("");
    if (!username.trim()) { setErr("Podaj login."); return; }
    if (pwError) { setErr(pwError); return; }
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
        <button className="primary" onClick={save} disabled={busy || !username.trim() || Boolean(pwError)}>Utwórz</button>
      </>}>
      {err && <div className="err">{err}</div>}
      <div>
        <label htmlFor={`${uid}-rola`}>Rola</label>
        <select id={`${uid}-rola`} value={role} onChange={(e) => setRole(e.target.value)}>
          {roleOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div><label htmlFor={`${uid}-imie-i-nazwisko-2`}>Imię i nazwisko</label>
        <input id={`${uid}-imie-i-nazwisko-2`} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="np. Jan Kowalski" /></div>
      <div><label htmlFor={`${uid}-login-3`}>Login</label>
        <input id={`${uid}-login-3`} value={username} onChange={(e) => setUsername(e.target.value)} /></div>
      <div><label htmlFor={`${uid}-haso-startowe-4`}>Hasło startowe</label>
        <div className="row">
          <input id={`${uid}-haso-startowe-4`} value={password} onChange={(e) => setPassword(e.target.value)} />
          <button onClick={() => setPassword(genStartPassword())} title="Wygeneruj">↻</button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{PASSWORD_HINT}</p>
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

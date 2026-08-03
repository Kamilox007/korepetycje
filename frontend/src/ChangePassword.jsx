import { useState } from "react";
import Modal from "./Modal";
import { api } from "./api";

export default function ChangePassword({ forced, onDone, onClose, onLogout }) {
  const [oldP, setOldP] = useState("");
  const [newP, setNewP] = useState("");
  const [newP2, setNewP2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr("");
    if (newP.length < 10) { setErr("Nowe hasło musi mieć min. 10 znaków."); return; }
    if (newP !== newP2) { setErr("Hasła nie są identyczne."); return; }
    setBusy(true);
    try {
      await api.changePassword(oldP, newP);
      onDone();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={forced ? "Ustaw nowe hasło" : "Zmiana hasła"}
      onClose={forced ? undefined : onClose}
      footer={<>
        {forced
          ? <button onClick={onLogout}>Wyloguj</button>
          : <button onClick={onClose}>Anuluj</button>}
        <button className="primary" onClick={save} disabled={busy}>Zapisz hasło</button>
      </>}
    >
      {forced && (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Logujesz się hasłem startowym. Ustaw własne hasło, aby kontynuować.
        </p>
      )}
      {err && <div className="err">{err}</div>}
      <div><label>Dotychczasowe hasło</label>
        <input type="password" value={oldP} onChange={(e) => setOldP(e.target.value)} /></div>
      <div><label>Nowe hasło</label>
        <input type="password" value={newP} onChange={(e) => setNewP(e.target.value)} /></div>
      <div><label>Powtórz nowe hasło</label>
        <input type="password" value={newP2} onChange={(e) => setNewP2(e.target.value)} /></div>
    </Modal>
  );
}

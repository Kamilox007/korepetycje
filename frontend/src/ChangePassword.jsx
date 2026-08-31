import { useState, useId } from "react";
import Modal from "./Modal";
import { api } from "./api";
import { PASSWORD_HINT, passwordError } from "./password";

export default function ChangePassword({ forced, onDone, onClose, onLogout }) {
  const uid = useId();
  const [oldP, setOldP] = useState("");
  const [newP, setNewP] = useState("");
  const [newP2, setNewP2] = useState("");
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr("");
    const pwError = passwordError(newP);
    if (pwError) { setErr(pwError); return; }
    if (newP !== newP2) { setErr("Hasła nie są identyczne."); return; }
    if (forced && !acceptPrivacy) { setErr("Musisz zaakceptować Regulamin i Politykę Prywatności, aby kontynuować."); return; }
    setBusy(true);
    try {
      await api.changePassword(oldP, newP, acceptPrivacy);
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
        <button className="primary" onClick={save} disabled={busy || (forced && !acceptPrivacy)}>Zapisz hasło</button>
      </>}
    >
      {forced && (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Logujesz się hasłem startowym. Ustaw własne hasło, aby kontynuować.
        </p>
      )}
      {err && <div className="err">{err}</div>}
      <div><label htmlFor={`${uid}-dotychczasowe-haso-1`}>Dotychczasowe hasło</label>
        <input id={`${uid}-dotychczasowe-haso-1`} type="password" value={oldP} onChange={(e) => setOldP(e.target.value)} /></div>
      <div>
        <label htmlFor={`${uid}-nowe-haso-2`}>Nowe hasło</label>
        <input id={`${uid}-nowe-haso-2`} type="password" value={newP} onChange={(e) => setNewP(e.target.value)} />
        <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{PASSWORD_HINT}</p>
      </div>
      <div><label htmlFor={`${uid}-powtorz-nowe-haso-3`}>Powtórz nowe hasło</label>
        <input id={`${uid}-powtorz-nowe-haso-3`} type="password" value={newP2} onChange={(e) => setNewP2(e.target.value)} /></div>
      {forced && (
        <div className="toggle-line">
          <input type="checkbox" id="accept-privacy" checked={acceptPrivacy}
            onChange={(e) => setAcceptPrivacy(e.target.checked)} />
          <label htmlFor="accept-privacy" style={{ margin: 0 }}>
            Zapoznałem/-am się z{" "}
            <a href="/regulamin.html" target="_blank" rel="noreferrer">Regulaminem</a>
            {" "}oraz{" "}
            <a href="/privacy-policy.html" target="_blank" rel="noreferrer">Polityką Prywatności</a>
            {" "}i akceptuję ich postanowienia.
          </label>
        </div>
      )}
    </Modal>
  );
}

import Modal from "./Modal";
import { PASSWORD_HINT, genStartPassword } from "./password";

/** Starting-password input with a "generate" button and the policy hint.
 *  Used wherever staff issue a password: new accounts, student accounts. */
export function StartPasswordField({ id, value, onChange }) {
  return (
    <div>
      <label htmlFor={id}>Hasło startowe</label>
      <div className="row">
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
        <button onClick={() => onChange(genStartPassword())} title="Wygeneruj">↻</button>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{PASSWORD_HINT}</p>
    </div>
  );
}

/** One-time display of freshly issued credentials. The password is shown
 *  here and nowhere else afterwards - the backend keeps only the hash. */
export function CredentialsModal({ title, intro, username, password, note, onDone }) {
  return (
    <Modal title={title} onClose={onDone}
      footer={<button className="primary" onClick={onDone}>Gotowe</button>}>
      <p style={{ margin: 0 }}>{intro}</p>
      <div className="cred-box">
        <div><span className="muted">Login:</span> <strong>{username}</strong></div>
        <div><span className="muted">Hasło:</span> <strong>{password}</strong></div>
      </div>
      {note && <p className="muted" style={{ fontSize: 12, margin: 0 }}>{note}</p>}
    </Modal>
  );
}

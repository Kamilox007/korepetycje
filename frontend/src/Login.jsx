import { useState, useId } from "react";

export default function Login({ onLogin }) {
  const uid = useId();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await onLogin(username.trim(), password);
    } catch (e) {
      setErr(e.message || "Nie udało się zalogować");
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          Korepetycje
          <small>panel logowania</small>
        </div>
        {err && <div className="err">{err}</div>}
        <div>
          <label htmlFor={`${uid}-login-1`}>Login</label>
          <input id={`${uid}-login-1`} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </div>
        <div>
          <label htmlFor={`${uid}-haso-2`}>Hasło</label>
          <input id={`${uid}-haso-2`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="primary" type="submit" disabled={busy || !username || !password} style={{ width: "100%" }}>
          {busy ? "Logowanie…" : "Zaloguj się"}
        </button>
      </form>
    </div>
  );
}

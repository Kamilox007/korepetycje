import { useState, useId } from "react";
import { useTheme } from "./useTheme";

export default function Login({ onLogin }) {
  const uid = useId();
  const { theme, toggle: toggleTheme } = useTheme();
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
        <div className="muted" style={{ fontSize: 12, textAlign: "center", display: "flex", gap: 12, justifyContent: "center" }}>
          <a href="/privacy-policy.html" target="_blank" rel="noreferrer">Polityka Prywatności</a>
          <a href="/regulamin.html" target="_blank" rel="noreferrer">Regulamin</a>
          <button type="button" onClick={toggleTheme}
            style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "var(--accent)", textDecoration: "underline", cursor: "pointer" }}>
            {theme === "dark" ? "Jasny motyw" : "Ciemny motyw"}
          </button>
        </div>
      </form>
    </div>
  );
}

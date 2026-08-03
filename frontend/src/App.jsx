import { useState, useEffect, useCallback } from "react";
import { usePersistentState } from "./usePersistentState";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api";
import Login from "./Login";
import ChangePassword from "./ChangePassword";
import Calendar from "./Calendar";
import Students from "./Students";
import Payments from "./Payments";
import Summary from "./Summary";
import Requests from "./Requests";
import Users from "./Users";
import Subjects from "./Subjects";
import TutorPanel from "./TutorPanel";
import StudentPanel from "./StudentPanel";

// zakładki administracji (admin + sekretariat). Użytkownicy widoczne dla obu,
// ale sekretariat nie zobaczy tam kont administracji (filtruje backend).
const STAFF_TABS = [
  { id: "calendar", label: "Kalendarz" },
  { id: "students", label: "Uczniowie" },
  { id: "payments", label: "Płatności" },
  { id: "summary", label: "Podsumowanie" },
  { id: "requests", label: "Prośby" },
  { id: "subjects", label: "Przedmioty" },
  { id: "users", label: "Użytkownicy" },
];

export default function App() {
  const [auth, setAuth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [forcePw, setForcePw] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth(null));
    (async () => {
      if (getToken()) {
        try {
          const me = await api.me();
          setAuth(me);
          setForcePw(me.must_change_password);
        } catch { setToken(null); }
      }
      setLoading(false);
    })();
  }, []);

  async function handleLogin(username, password) {
    const res = await api.login(username, password);
    setToken(res.access_token);
    setAuth({
      role: res.role, username: res.username,
      display_name: res.display_name, must_change_password: res.must_change_password,
    });
    setForcePw(res.must_change_password);
  }

  function logout() { setToken(null); setAuth(null); }

  if (loading) return <div className="empty" style={{ marginTop: 80 }}>Ładowanie…</div>;
  if (!auth) return <Login onLogin={handleLogin} />;

  const isStaff = auth.role === "admin" || auth.role === "secretary";

  // dopóki konto jest na haśle startowym, backend odrzuca wszystko poza zmianą hasła —
  // nie montuj paneli, bo ich zapytania zwrócą 403
  if (forcePw) {
    return <ChangePassword forced onDone={() => setForcePw(false)} onLogout={logout} />;
  }

  return (
    <>
      {isStaff && <StaffShell auth={auth} onLogout={logout} />}
      {auth.role === "tutor" && <RoleShell auth={auth} onLogout={logout} subtitle="panel korepetytora"><TutorPanel /></RoleShell>}
      {auth.role === "student" && <RoleShell auth={auth} onLogout={logout} subtitle="panel ucznia"><StudentPanel /></RoleShell>}
    </>
  );
}

function Sidebar({ auth, subtitle, onLogout, tabs, activeTab, setTab, badge }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        Korepetycje
        <small>{subtitle}</small>
      </div>
      {tabs.map((t) => (
        <button key={t.id} className={`nav-item${activeTab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
          <span>{t.label}</span>
          {t.id === "requests" && badge > 0 && <span className="nav-badge">{badge}</span>}
        </button>
      ))}
      <div className="spacer" />
      <div className="sidebar-user">
        <div className="muted" style={{ fontSize: 12, padding: "0 8px 6px" }}>{auth.display_name || auth.username}</div>
        <button className="nav-item" onClick={onLogout}><span>Wyloguj</span></button>
      </div>
    </aside>
  );
}

// prosty shell dla ról bez zakładek (korepetytor, uczeń)
function RoleShell({ auth, subtitle, onLogout, children }) {
  return (
    <div className="app">
      <Sidebar auth={auth} subtitle={subtitle} onLogout={onLogout} tabs={[]} activeTab="" setTab={() => {}} badge={0} />
      <main className="main">{children}</main>
    </div>
  );
}

function StaffShell({ auth, onLogout }) {
  const [tab, setTab] = usePersistentState("staff_tab", "calendar");
  const [students, setStudents] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, setPending] = useState(0);

  const loadStudents = useCallback(async () => {
    try { setStudents(await api.listStudents()); } catch { setStudents([]); }
  }, []);
  const refresh = useCallback(() => { loadStudents(); setRefreshKey((k) => k + 1); }, [loadStudents]);

  useEffect(() => { loadStudents(); }, [loadStudents]);
  useEffect(() => {
    api.listReschedule().then((rs) => setPending(rs.filter((r) => r.status === "pending").length)).catch(() => {});
  }, [refreshKey, tab]);

  const subtitle = auth.role === "admin" ? "panel administratora" : "panel sekretariatu";

  return (
    <div className="app">
      <Sidebar auth={auth} subtitle={subtitle} onLogout={onLogout}
        tabs={STAFF_TABS} activeTab={tab} setTab={setTab} badge={pending} />
      <main className="main">
        {tab === "calendar" && <Calendar students={students} onChanged={refresh} />}
        {tab === "students" && <Students students={students} reload={refresh} />}
        {tab === "payments" && <Payments students={students} reload={refresh} />}
        {tab === "summary" && <Summary refreshKey={refreshKey} />}
        {tab === "requests" && <Requests reload={refresh} />}
        {tab === "subjects" && <Subjects />}
        {tab === "users" && <Users myRole={auth.role} />}
      </main>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { usePersistentState } from "./usePersistentState";
import { api, setUnauthorizedHandler } from "./api";
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

// Staff tabs (admin + secretary). Users is visible to both, but a secretary
// will not see staff accounts there; the backend filters them out.
//
// Paths are in Polish to match the labels: an address a parent might be sent
// should read the same as the tab it opens.
const STAFF_TABS = [
  { path: "/kalendarz", label: "Kalendarz" },
  { path: "/uczniowie", label: "Uczniowie" },
  { path: "/platnosci", label: "Płatności" },
  { path: "/podsumowanie", label: "Podsumowanie" },
  { path: "/prosby", label: "Prośby" },
  { path: "/przedmioty", label: "Przedmioty" },
  { path: "/uzytkownicy", label: "Użytkownicy" },
];

const TUTOR_TABS = [
  { path: "/zajecia", label: "Zajęcia" },
  { path: "/rozliczenia", label: "Rozliczenia" },
  { path: "/prosby", label: "Prośby" },
  { path: "/dyspozycyjnosc", label: "Dyspozycyjność" },
];

const STUDENT_TABS = [
  { path: "/zajecia", label: "Zajęcia" },
  { path: "/platnosci", label: "Płatności" },
  { path: "/prosby", label: "Prośby" },
];

export default function App() {
  const [auth, setAuth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [forcePw, setForcePw] = useState(false);
  const [showPw, setShowPw] = useState(false);
  // Pending reschedule requests, shown as a badge next to the tutor's Prośby tab.
  const [pending, setPending] = useState(0);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth(null));
    (async () => {
      // An httponly cookie cannot be inspected from JS, so we ask the backend
      // whether a session exists. A 401 at startup simply means "not logged in".
      try {
        const me = await api.me();
        setAuth(me);
        setForcePw(me.must_change_password);
      } catch { /* brak sesji */ }
      setLoading(false);
    })();
  }, []);

  async function handleLogin(username, password) {
    const res = await api.login(username, password);
    // The backend set the cookie in its response; only UI state is left to do here.
    setAuth({
      role: res.role, username: res.username,
      display_name: res.display_name, must_change_password: res.must_change_password,
    });
    setForcePw(res.must_change_password);
  }

  async function logout() {
    // An httponly cookie cannot be cleared from JavaScript; the backend has to
    // do it, otherwise logging out would be cosmetic.
    try { await api.logout(); } catch { /* i tak czyścimy stan */ }
    setAuth(null);
  }

  useEffect(() => {
    if (auth?.role !== "tutor") return;
    api.tutorReschedule()
      .then((rs) => setPending(rs.filter((r) => r.status === "pending").length))
      .catch(() => {});
  }, [auth]);

  if (loading) return <div className="empty" style={{ marginTop: 80 }}>Ładowanie…</div>;
  if (!auth) return <Login onLogin={handleLogin} />;

  const isStaff = auth.role === "admin" || auth.role === "secretary";

  // While the account sits on its starting password the backend rejects everything
  // but the password change, so do not mount the panels: their requests return 403.
  if (forcePw) {
    return <ChangePassword forced onDone={() => setForcePw(false)} onLogout={logout} />;
  }

  return (
    <>
      {isStaff && <StaffShell auth={auth} onLogout={logout} onChangePassword={() => setShowPw(true)} />}
      {auth.role === "tutor" && (
        <RoleShell auth={auth} onLogout={logout} onChangePassword={() => setShowPw(true)}
                   subtitle="panel korepetytora" tabs={TUTOR_TABS} badge={pending}>
          <Routes>
            <Route path="/zajecia" element={<TutorPanel section="lessons" />} />
            <Route path="/rozliczenia" element={<Summary tutorView />} />
            <Route path="/prosby" element={<TutorPanel section="requests" />} />
            <Route path="/dyspozycyjnosc" element={<TutorPanel section="availability" />} />
            <Route path="*" element={<Navigate to="/zajecia" replace />} />
          </Routes>
        </RoleShell>
      )}
      {auth.role === "student" && (
        <RoleShell auth={auth} onLogout={logout} onChangePassword={() => setShowPw(true)}
                   subtitle="panel ucznia" tabs={STUDENT_TABS}>
          <Routes>
            <Route path="/zajecia" element={<StudentPanel section="lessons" />} />
            <Route path="/platnosci" element={<StudentPanel section="payments" />} />
            <Route path="/prosby" element={<StudentPanel section="requests" />} />
            <Route path="*" element={<Navigate to="/zajecia" replace />} />
          </Routes>
        </RoleShell>
      )}
      {showPw && <ChangePassword onClose={() => setShowPw(false)} onDone={() => setShowPw(false)} />}
    </>
  );
}

function Sidebar({ auth, subtitle, onLogout, onChangePassword, tabs, badge }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        Korepetycje
        <small>{subtitle}</small>
      </div>
      {tabs.map((t) => (
        // NavLink renders an <a>, so the browser back button, bookmarks and
        // middle-click all work the way people expect them to.
        <NavLink
          key={t.path}
          to={t.path}
          className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
        >
          <span>{t.label}</span>
          {t.path === "/prosby" && badge > 0 && <span className="nav-badge">{badge}</span>}
        </NavLink>
      ))}
      <div className="spacer" />
      <div className="sidebar-user">
        <div className="muted" style={{ fontSize: 12, padding: "0 8px 6px" }}>{auth.display_name || auth.username}</div>
        <button className="nav-item" onClick={onChangePassword}><span>Zmień hasło</span></button>
        <button className="nav-item" onClick={onLogout}><span>Wyloguj</span></button>
      </div>
    </aside>
  );
}

// Simple shell for roles without tabs (tutor, student)
function RoleShell({ auth, subtitle, onLogout, onChangePassword, tabs = [], badge = 0, children }) {
  return (
    <div className="app">
      <Sidebar auth={auth} subtitle={subtitle} onLogout={onLogout}
               onChangePassword={onChangePassword} tabs={tabs} badge={badge} />
      <main className="main">{children}</main>
    </div>
  );
}

function StaffShell({ auth, onLogout, onChangePassword }) {
  const location = useLocation();
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
  }, [refreshKey, location.pathname]);

  const subtitle = auth.role === "admin" ? "panel administratora" : "panel sekretariatu";

  return (
    <div className="app">
      <Sidebar auth={auth} subtitle={subtitle} onLogout={onLogout}
               onChangePassword={onChangePassword} tabs={STAFF_TABS} badge={pending} />
      <main className="main">
        <Routes>
          <Route path="/kalendarz" element={<Calendar students={students} onChanged={refresh} />} />
          <Route path="/uczniowie" element={<Students students={students} reload={refresh} />} />
          <Route path="/platnosci" element={<Payments students={students} reload={refresh} />} />
          <Route path="/podsumowanie" element={<Summary refreshKey={refreshKey} />} />
          <Route path="/prosby" element={<Requests reload={refresh} />} />
          <Route path="/przedmioty" element={<Subjects />} />
          <Route path="/uzytkownicy" element={<Users myRole={auth.role} />} />
          {/* Anything else, including "/", lands on the calendar. */}
          <Route path="*" element={<Navigate to="/kalendarz" replace />} />
        </Routes>
      </main>
    </div>
  );
}

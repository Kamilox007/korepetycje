const BASE = "/api";

// Token nie jest przechowywany po stronie JavaScriptu. Backend wystawia go
// in an httponly cookie that scripts cannot read, so XSS is not enough to
// hijack a session. The browser attaches it automatically, because the frontend
// and the API are served from the same domain.

// callback invoked on 401 (e.g. to log the user out)
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function req(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };

  const res = await fetch(BASE + path, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (res.status === 401) {
    if (onUnauthorized) onUnauthorized();
    throw new Error("401: sesja wygasła");
  }
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const j = await res.json();
      detail = j.detail || JSON.stringify(j);
    } catch { detail = await res.text(); }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : null;
}

export const api = {
  // ----- auth -----
  login: async (username, password) => {
    // OAuth2PasswordRequestForm wymaga form-urlencoded
    const body = new URLSearchParams({ username, password });
    const res = await fetch(BASE + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      credentials: "same-origin",
    });
    if (!res.ok) {
      let d = "Błąd logowania";
      try { d = (await res.json()).detail || d; } catch {}
      throw new Error(d);
    }
    return res.json();
  },
  me: () => req("/auth/me"),
  changePassword: (oldP, newP, acceptPrivacy = false) =>
    // The backend refreshes the cookie in its response, so there is nothing to
    // store here. The old token was short-lived, the new one is full length.
    req("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ old_password: oldP, new_password: newP, accept_privacy: acceptPrivacy }),
    }),

  logout: () => req("/auth/logout", { method: "POST" }),

  // ----- students (korepetytor) -----
  listStudents: (archived = false) =>
    req(`/students${archived ? "?archived=true" : ""}`),
  createStudent: (data) => req("/students", { method: "POST", body: JSON.stringify(data) }),
  updateStudent: (id, data) => req(`/students/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  // Archiwizuje: uczeń znika z list, historia zostaje.
  archiveStudent: (id) => req(`/students/${id}`, { method: "DELETE" }),
  restoreStudent: (id) => req(`/students/${id}/restore`, { method: "POST" }),
  // Nieodwracalne usunięcie danych (RODO art. 17). Tylko admin, tylko z archiwum.
  purgeStudent: (id) => req(`/students/${id}/purge`, { method: "DELETE" }),
  createStudentAccount: (id, data) =>
    req(`/students/${id}/account`, { method: "POST", body: JSON.stringify(data) }),
  deleteStudentAccount: (id) => req(`/students/${id}/account`, { method: "DELETE" }),

  // ----- series -----
  listSeries: () => req("/series"),
  createSeries: (data) => req("/series", { method: "POST", body: JSON.stringify(data) }),
  // Zmiany metadanych trafiają na przyszłe zajęcia, godziny - tylko na te,
  // których nikt ręcznie nie przesunął. Szczegóły w docstringu endpointu.
  updateSeries: (id, data) =>
    req(`/series/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteSeries: (id) => req(`/series/${id}`, { method: "DELETE" }),

  // ----- lessons -----
  listLessons: ({ start, end, studentId } = {}) => {
    const p = new URLSearchParams();
    if (start) p.set("start", start);
    if (end) p.set("end", end);
    if (studentId) p.set("student_id", studentId);
    return req(`/lessons?${p.toString()}`);
  },
  createLesson: (data) => req("/lessons", { method: "POST", body: JSON.stringify(data) }),
  updateLesson: (id, data) => req(`/lessons/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteLesson: (id) => req(`/lessons/${id}`, { method: "DELETE" }),

  // ----- payments -----
  listPayments: (studentId) => req(`/payments${studentId ? `?student_id=${studentId}` : ""}`),
  createPayment: (data) => req("/payments", { method: "POST", body: JSON.stringify(data) }),
  updatePayment: (id, data) =>
    req(`/payments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deletePayment: (id) => req(`/payments/${id}`, { method: "DELETE" }),

  // ----- summary -----
  summary: () => req("/summary"),

  // ----- reschedule (administracja) -----
  listReschedule: () => req("/reschedule-requests"),
  approveReschedule: (id, response) =>
    req(`/reschedule-requests/${id}/approve`, { method: "POST", body: JSON.stringify({ response: response || null }) }),
  rejectReschedule: (id, response) =>
    req(`/reschedule-requests/${id}/reject`, { method: "POST", body: JSON.stringify({ response: response || null }) }),

  // ----- user management (admin / secretary) -----
  listUsers: () => req("/users"),
  listTutors: () => req("/tutors"),
  createUser: (data) => req("/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id, data) => req(`/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteUser: (id) => req(`/users/${id}`, { method: "DELETE" }),
  // Zwraca nowe hasło startowe - pokazywane raz, nigdzie nie przechowywane.
  resetUserPassword: (id) =>
    req(`/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({}) }),
  assignTutor: (lessonId, tutorId) =>
    req(`/lessons/${lessonId}/assign${tutorId ? `?tutor_id=${tutorId}` : ""}`, { method: "POST" }),

  // ----- korepetytor -----
  tutorSummary: () => req("/tutor/summary"),
  tutorPayments: () => req("/tutor/payments"),
  tutorLessons: ({ start, end } = {}) => {
    const p = new URLSearchParams();
    if (start) p.set("start", start);
    if (end) p.set("end", end);
    return req(`/tutor/lessons?${p.toString()}`);
  },
  tutorUpdateLesson: (id, data) =>
    req(`/tutor/lessons/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  tutorAvailability: () => req("/tutor/availability"),
  tutorAddAvailability: (data) =>
    req("/tutor/availability", { method: "POST", body: JSON.stringify(data) }),
  tutorDeleteAvailability: (id) => req(`/tutor/availability/${id}`, { method: "DELETE" }),
  tutorReschedule: () => req("/tutor/reschedule-requests"),
  tutorApproveReschedule: (id, response) =>
    req(`/tutor/reschedule-requests/${id}/approve`, { method: "POST", body: JSON.stringify({ response: response || null }) }),
  tutorRejectReschedule: (id, response) =>
    req(`/tutor/reschedule-requests/${id}/reject`, { method: "POST", body: JSON.stringify({ response: response || null }) }),

  // ----- przedmioty -----
  listSubjects: () => req("/subjects"),
  createSubject: (data) => req("/subjects", { method: "POST", body: JSON.stringify(data) }),
  deleteSubject: (id) => req(`/subjects/${id}`, { method: "DELETE" }),

  // ----- panel ucznia -----
  myLessons: ({ start, end } = {}) => {
    const p = new URLSearchParams();
    if (start) p.set("start", start);
    if (end) p.set("end", end);
    return req(`/me/lessons?${p.toString()}`);
  },
  mySummary: () => req("/me/summary"),
  myTransferInfo: () => req("/me/transfer"),
  myPayments: () => req("/me/payments"),
  myReschedule: () => req("/me/reschedule-requests"),
  myLessonSlots: (lessonId) => req(`/me/lessons/${lessonId}/available-slots`),
  requestReschedule: (data) =>
    req("/me/reschedule-requests", { method: "POST", body: JSON.stringify(data) }),
};

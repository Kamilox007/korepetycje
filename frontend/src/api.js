const BASE = "/api";

// Token nie jest przechowywany po stronie JavaScriptu. Backend wystawia go
// in an httponly cookie that scripts cannot read, so XSS is not enough to
// hijack a session. The browser attaches it automatically, because the frontend
// and the API are served from the same domain.

// callback invoked on 401 (e.g. to log the user out)
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

// The backend answers errors with {"detail": "..."} (FastAPI); anything else
// falls back to the status code so the user still sees *something*.
async function errorFrom(res, fallback = `${res.status}`) {
  let detail = fallback;
  try {
    const j = await res.json();
    detail = j.detail || JSON.stringify(j);
  } catch { /* not JSON */ }
  return new Error(detail);
}

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
  if (!res.ok) throw await errorFrom(res);
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : null;
}

// A state-changing call with a JSON body. `data` may be omitted for endpoints
// that take none (POST /x/restore etc.).
const send = (method, path, data) =>
  req(path, { method, ...(data !== undefined && { body: JSON.stringify(data) }) });
const post = (path, data) => send("POST", path, data);
const put = (path, data) => send("PUT", path, data);
const patch = (path, data) => send("PATCH", path, data);
const del = (path) => send("DELETE", path);

// Query string from an object; empty values are left out, and so is the "?"
// when nothing remains.
function query(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const q = p.toString();
  return q ? `?${q}` : "";
}

// Multipart upload: no JSON header, the browser sets the boundary itself.
async function upload(path, form) {
  const res = await fetch(BASE + path, { method: "POST", body: form, credentials: "same-origin" });
  if (res.status === 401 && onUnauthorized) onUnauthorized();
  if (!res.ok) throw await errorFrom(res);
  return res.json();
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
    if (!res.ok) throw await errorFrom(res, "Błąd logowania");
    return res.json();
  },
  me: () => req("/auth/me"),
  changePassword: (oldP, newP, acceptPrivacy = false) =>
    // The backend refreshes the cookie in its response, so there is nothing to
    // store here. The old token was short-lived, the new one is full length.
    post("/auth/change-password", { old_password: oldP, new_password: newP, accept_privacy: acceptPrivacy }),

  logout: () => post("/auth/logout"),

  // ----- students (korepetytor) -----
  listStudents: (archived = false) => req(`/students${query({ archived: archived ? "true" : "" })}`),
  createStudent: (data) => post("/students", data),
  updateStudent: (id, data) => patch(`/students/${id}`, data),
  // Archiwizuje: uczeń znika z list, historia zostaje.
  archiveStudent: (id) => del(`/students/${id}`),
  restoreStudent: (id) => post(`/students/${id}/restore`),
  // Nieodwracalne usunięcie danych (RODO art. 17). Tylko admin, tylko z archiwum.
  purgeStudent: (id) => del(`/students/${id}/purge`),
  createStudentAccount: (id, data) =>
    post(`/students/${id}/account`, data),
  deleteStudentAccount: (id) => del(`/students/${id}/account`),

  // ----- series -----
  listSeries: () => req("/series"),
  createSeries: (data) => post("/series", data),
  // Zmiany metadanych trafiają na przyszłe zajęcia, godziny - tylko na te,
  // których nikt ręcznie nie przesunął. Szczegóły w docstringu endpointu.
  updateSeries: (id, data) =>
    patch(`/series/${id}`, data),
  deleteSeries: (id) => del(`/series/${id}`),

  // ----- lessons -----
  listLessons: ({ start, end, studentId } = {}) =>
    req(`/lessons${query({ start, end, student_id: studentId })}`),
  createLesson: (data) => post("/lessons", data),
  updateLesson: (id, data) => patch(`/lessons/${id}`, data),
  deleteLesson: (id) => del(`/lessons/${id}`),

  // ----- payments -----
  listPayments: (studentId) => req(`/payments${query({ student_id: studentId })}`),
  createPayment: (data) => post("/payments", data),
  updatePayment: (id, data) =>
    patch(`/payments/${id}`, data),
  deletePayment: (id) => del(`/payments/${id}`),

  // ----- summary -----
  summary: () => req("/summary"),
  quarterlyLimits: () => req("/summary/quarterly-limits"),
  incomeLimits: () => req("/income-limits"),
  addIncomeLimit: (data) => post("/income-limits", data),
  deleteIncomeLimit: (id) => del(`/income-limits/${id}`),

  // ----- reschedule (administracja) -----
  listReschedule: () => req("/reschedule-requests"),
  approveReschedule: (id, response) =>
    post(`/reschedule-requests/${id}/approve`, { response: response || null }),
  rejectReschedule: (id, response) =>
    post(`/reschedule-requests/${id}/reject`, { response: response || null }),

  // ----- user management (admin / secretary) -----
  listUsers: () => req("/users"),
  listTutors: () => req("/tutors"),
  createUser: (data) => post("/users", data),
  updateUser: (id, data) => patch(`/users/${id}`, data),
  deleteUser: (id) => del(`/users/${id}`),
  // Zwraca nowe hasło startowe - pokazywane raz, nigdzie nie przechowywane.
  resetUserPassword: (id) =>
    post(`/users/${id}/reset-password`, {}),
  assignTutor: (lessonId, tutorId) =>
    post(`/lessons/${lessonId}/assign${tutorId ? `?tutor_id=${tutorId}` : ""}`),

  // ----- korepetytor -----
  tutorSummary: () => req("/tutor/summary"),
  // A tutor has no /students endpoint: the students they teach are the ones in
  // their summary (the same "any lesson" rule the backend applies everywhere).
  tutorStudents: () =>
    req("/tutor/summary").then((s) => s.students.map((x) => ({ id: x.student_id, name: x.student_name }))),
  tutorPayments: () => req("/tutor/payments"),
  myQuarterlyLimit: () => req("/me/quarterly-limit"),
  calendarFeed: () => req("/me/calendar-feed"),
  regenerateCalendarFeed: () => post("/me/calendar-feed/regenerate"),
  tutorLessons: (range) => req(`/tutor/lessons${query(range)}`),
  tutorUpdateLesson: (id, data) =>
    patch(`/tutor/lessons/${id}`, data),
  tutorAvailability: () => req("/tutor/availability"),
  tutorAddAvailability: (data) =>
    post("/tutor/availability", data),
  tutorDeleteAvailability: (id) => del(`/tutor/availability/${id}`),
  tutorReschedule: () => req("/tutor/reschedule-requests"),
  tutorApproveReschedule: (id, response) =>
    post(`/tutor/reschedule-requests/${id}/approve`, { response: response || null }),
  tutorRejectReschedule: (id, response) =>
    post(`/tutor/reschedule-requests/${id}/reject`, { response: response || null }),

  // ----- tablice (panel) -----
  listBoards: ({ studentId, archived } = {}) =>
    req(`/boards${query({ student_id: studentId, archived: archived ? "true" : "" })}`),
  getBoard: (id) => req(`/boards/${id}`),
  createBoard: (data) => post("/boards", data),
  updateBoard: (id, data) => patch(`/boards/${id}`, data),
  // Nowy link; stary przestaje działać natychmiast, treść zostaje.
  rotateBoardToken: (id) => post(`/boards/${id}/rotate-token`),
  archiveBoard: (id) => del(`/boards/${id}`),
  restoreBoard: (id) => post(`/boards/${id}/restore`),
  // Nieodwracalne. Tylko admin, tylko z archiwum.
  purgeBoard: (id) => del(`/boards/${id}/purge`),
  listBoardSnapshots: (id) => req(`/boards/${id}/snapshots`),
  restoreBoardSnapshot: (id, snapshotId) =>
    post(`/boards/${id}/snapshots/${snapshotId}/restore`),

  // Biblioteka kształtów tablicy zapisana na koncie (nie per tablica).
  myBoardLibrary: () => req("/me/board-library"),
  saveMyBoardLibrary: (items) =>
    put("/me/board-library", { items }),

  // ----- tablica (po linku, bez logowania) -----
  // Osobna rodzina wywołań: te trasy nie wymagają sesji i nie mogą wylogować
  // użytkownika przy 401 (gość nie ma sesji, którą dałoby się stracić).
  board: (token) => req(`/t/${token}`),
  boardPage: (token, pageId) => req(`/t/${token}/pages/${pageId}`),
  saveBoardPage: (token, pageId, elements) =>
    put(`/t/${token}/pages/${pageId}`, { elements }),
  addBoardPage: (token, title) =>
    post(`/t/${token}/pages`, { title: title || null }),
  renameBoardPage: (token, pageId, title) =>
    patch(`/t/${token}/pages/${pageId}`, { title }),
  deleteBoardPage: (token, pageId) => del(`/t/${token}/pages/${pageId}`),
  uploadBoardFile: (token, fileId, blob) => {
    const form = new FormData();
    form.append("file_id", fileId);
    form.append("file", blob, fileId);
    return upload(`/t/${token}/files`, form);
  },
  boardFileUrl: (token, fileId) => `${BASE}/t/${token}/files/${fileId}`,

  // ----- materiały ucznia (PDF) -----
  listStudentFiles: (studentId) => req(`/students/${studentId}/files`),
  uploadStudentFile: (studentId, file) => {
    const form = new FormData();
    form.append("file", file, file.name);
    return upload(`/students/${studentId}/files`, form);
  },
  deleteStudentFile: (studentId, fileId) => del(`/students/${studentId}/files/${fileId}`),
  studentFileUrl: (studentId, fileId) => `${BASE}/students/${studentId}/files/${fileId}/content`,

  // ----- przedmioty -----
  listSubjects: () => req("/subjects"),
  createSubject: (data) => post("/subjects", data),
  deleteSubject: (id) => del(`/subjects/${id}`),

  // ----- panel ucznia -----
  myLessons: (range) => req(`/me/lessons${query(range)}`),
  mySummary: () => req("/me/summary"),
  myTransferInfo: () => req("/me/transfer"),
  myPayments: () => req("/me/payments"),
  myReschedule: () => req("/me/reschedule-requests"),
  myLessonSlots: (lessonId) => req(`/me/lessons/${lessonId}/available-slots`),
  requestReschedule: (data) =>
    post("/me/reschedule-requests", data),
  // Tablice przypisane do ucznia (z linkami) i jego materiały.
  myBoards: () => req("/me/boards"),
  myFiles: () => req("/me/files"),
  myFileUrl: (fileId) => `${BASE}/me/files/${fileId}/content`,
};

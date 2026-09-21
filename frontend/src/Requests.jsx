import { useState, useEffect, useId } from "react";
import { api } from "./api";
import Modal from "./Modal";
import { fmtTime } from "./dates";

// The staff and tutor panels show the same two tables and the same decision
// dialog; only the endpoints differ (a tutor sees and decides on the requests
// for their own lessons only, the backend filters). `tutorView` picks the pair.
const STAFF_API = { approve: api.approveReschedule, reject: api.rejectReschedule };
const TUTOR_API = { approve: api.tutorApproveReschedule, reject: api.tutorRejectReschedule };

export default function Requests({ reload }) {
  const [requests, setRequests] = useState([]);
  const [decision, setDecision] = useState(null); // { req, action }

  async function load() {
    setRequests(await api.listReschedule());
  }
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="page-head"><h1>Prośby o przesunięcie</h1></div>
      <RequestTables requests={requests} onDecide={setDecision} />
      {decision && (
        <DecisionModal
          decision={decision}
          onClose={() => setDecision(null)}
          onDone={async () => { setDecision(null); await load(); reload?.(); }}
        />
      )}
    </div>
  );
}

/** Pending requests with Akceptuj/Odrzuć, then the ones already decided. */
export function RequestTables({ requests, onDecide }) {
  const pending = requests.filter((r) => r.status === "pending");
  const handled = requests.filter((r) => r.status !== "pending");
  return (
    <div>
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Oczekujące</h2>
      <div className="card" style={{ marginBottom: 24 }}>
        {pending.length === 0 ? (
          <div className="empty"><p>Brak oczekujących próśb.</p></div>
        ) : (
          <table>
            <thead><tr><th>Uczeń</th><th>Obecny termin</th><th>Proponowany</th><th>Wiadomość</th><th></th></tr></thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>{r.student_name}</td>
                  <td>{r.lesson_date} {fmtTime(r.lesson_time)}</td>
                  <td>{r.proposed_date || "-"} {fmtTime(r.proposed_time)}</td>
                  <td className="muted">{r.message || ""}</td>
                  <td className="num row" style={{ justifyContent: "flex-end" }}>
                    <button className="primary" onClick={() => onDecide({ req: r, action: "approve" })}>Akceptuj</button>
                    <button className="danger" onClick={() => onDecide({ req: r, action: "reject" })}>Odrzuć</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {handled.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>Rozpatrzone</h2>
          <div className="card">
            <table>
              <thead><tr><th>Uczeń</th><th>Termin</th><th>Status</th><th>Komentarz</th></tr></thead>
              <tbody>
                {handled.map((r) => (
                  <tr key={r.id}>
                    <td>{r.student_name}</td>
                    <td>{r.proposed_date || r.lesson_date} {fmtTime(r.proposed_time || r.lesson_time)}</td>
                    <td>
                      {r.status === "approved"
                        ? <span className="badge done">zaakceptowana</span>
                        : <span className="badge due">odrzucona</span>}
                    </td>
                    <td className="muted">{r.response || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export function DecisionModal({ decision, onClose, onDone, tutorView = false }) {
  const uid = useId();
  const { req, action } = decision;
  const approve = action === "approve";
  const [response, setResponse] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const calls = tutorView ? TUTOR_API : STAFF_API;

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      await (approve ? calls.approve : calls.reject)(req.id, response);
      onDone();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={approve ? "Akceptacja prośby" : "Odrzucenie prośby"}
      onClose={onClose}
      footer={<>
        <button onClick={onClose}>Anuluj</button>
        <button className={approve ? "primary" : "danger"} onClick={submit} disabled={busy}>
          {approve ? "Akceptuj" : "Odrzuć"}
        </button>
      </>}
    >
      {err && <div className="err">{err}</div>}
      <p style={{ margin: 0 }}>
        {req.student_name} - {approve ? "termin zostanie zmieniony na " : "prośba o "}
        <strong>{req.proposed_date} {fmtTime(req.proposed_time)}</strong>
      </p>
      {req.message && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Wiadomość ucznia: {req.message}</p>}
      <div>
        <label htmlFor={`${uid}-komentarz-dla-ucznia-1`}>Komentarz dla ucznia {approve ? "(opcjonalnie)" : "(np. dlaczego termin nie pasuje)"}</label>
        <textarea id={`${uid}-komentarz-dla-ucznia-1`} rows={3} value={response} onChange={(e) => setResponse(e.target.value)}
          placeholder={approve ? "np. Potwierdzam nowy termin" : "np. Mam wtedy inne zajęcia, proszę o inny termin"} />
      </div>
    </Modal>
  );
}

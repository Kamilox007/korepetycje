import { useState, useEffect } from "react";
import { api } from "./api";
import Modal from "./Modal";
import { fmtTime } from "./dates";

export default function Requests({ reload }) {
  const [requests, setRequests] = useState([]);
  const [decision, setDecision] = useState(null); // { req, action }

  async function load() {
    setRequests(await api.listReschedule());
  }
  useEffect(() => { load(); }, []);

  const pending = requests.filter((r) => r.status === "pending");
  const handled = requests.filter((r) => r.status !== "pending");

  return (
    <div>
      <div className="page-head"><h1>Prośby o przesunięcie</h1></div>

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
                  <td>{r.proposed_date || "—"} {fmtTime(r.proposed_time)}</td>
                  <td className="muted">{r.message || ""}</td>
                  <td className="num row" style={{ justifyContent: "flex-end" }}>
                    <button className="primary" onClick={() => setDecision({ req: r, action: "approve" })}>Akceptuj</button>
                    <button className="danger" onClick={() => setDecision({ req: r, action: "reject" })}>Odrzuć</button>
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

function DecisionModal({ decision, onClose, onDone }) {
  const { req, action } = decision;
  const approve = action === "approve";
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    if (approve) await api.approveReschedule(req.id, response);
    else await api.rejectReschedule(req.id, response);
    onDone();
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
      <p style={{ margin: 0 }}>
        {req.student_name} — {approve ? "termin zostanie zmieniony na " : "prośba o "}
        <strong>{req.proposed_date} {fmtTime(req.proposed_time)}</strong>
      </p>
      {req.message && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Wiadomość ucznia: {req.message}</p>}
      <div>
        <label>Komentarz dla ucznia {approve ? "(opcjonalnie)" : "(np. dlaczego termin nie pasuje)"}</label>
        <textarea rows={3} value={response} onChange={(e) => setResponse(e.target.value)}
          placeholder={approve ? "np. Potwierdzam nowy termin" : "np. Mam wtedy inne zajęcia, proszę o inny termin"} />
      </div>
    </Modal>
  );
}

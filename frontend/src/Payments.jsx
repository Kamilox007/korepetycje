import { useState, useEffect } from "react";
import { api } from "./api";
import Modal from "./Modal";
import { fmtMoney } from "./dates";
import { useConfirm } from "./Confirm";

export default function Payments({ students, reload }) {
  const confirm = useConfirm();
  const [payments, setPayments] = useState([]);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setPayments(await api.listPayments());
  }
  useEffect(() => { load(); }, []);

  async function remove(p) {
    const ok = await confirm({
      title: "Usunąć wpłatę?",
      message: `Wpłata ${fmtMoney(p.amount)} z dnia ${p.date} zostanie usunięta.`,
      consequence: "Saldo ucznia zmieni się natychmiast. Operacji nie da się cofnąć.",
      confirmLabel: "Usuń wpłatę",
    });
    if (!ok) return;
    await api.deletePayment(p.id);
    load();
    reload();
  }

  return (
    <div>
      <div className="page-head">
        <h1>Płatności</h1>
        <button className="primary" onClick={() => setShowForm(true)}>+ Dodaj wpłatę</button>
      </div>

      <div className="card">
        {payments.length === 0 ? (
          <div className="empty">
            <p>Brak zarejestrowanych wpłat.</p>
            <button className="primary" onClick={() => setShowForm(true)}>Dodaj pierwszą wpłatę</button>
          </div>
        ) : (
          <table>
            <thead>
              <tr><th>Data</th><th>Uczeń</th><th>Od kogo</th><th>Notatka</th><th className="num">Kwota</th><th></th></tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="muted">{p.date}</td>
                  <td style={{ fontWeight: 500 }}>{p.student_name}</td>
                  <td>{p.payer || "—"}</td>
                  <td className="muted">{p.note || ""}</td>
                  <td className="num" style={{ fontWeight: 600, color: "var(--done)" }}>{fmtMoney(p.amount)}</td>
                  <td className="num"><button className="ghost danger" onClick={() => remove(p)}>Usuń</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <PaymentForm
          students={students}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); reload(); }}
        />
      )}
    </div>
  );
}

function PaymentForm({ students, onClose, onSaved }) {
  const [studentId, setStudentId] = useState(students[0]?.id || "");
  const [amount, setAmount] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [payer, setPayer] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!students.length) {
    return <Modal title="Brak uczniów" onClose={onClose}><p>Najpierw dodaj ucznia.</p></Modal>;
  }

  async function save() {
    if (!amount) return;
    setBusy(true);
    await api.createPayment({
      student_id: Number(studentId),
      amount: Number(amount),
      date,
      payer: payer || null,
      note: note || null,
    });
    onSaved();
  }

  const sName = students.find((s) => s.id === Number(studentId))?.name;

  return (
    <Modal
      title="Nowa wpłata"
      onClose={onClose}
      footer={<>
        <button onClick={onClose}>Anuluj</button>
        <button className="primary" onClick={save} disabled={busy || !amount}>Zapisz</button>
      </>}
    >
      <div>
        <label>Za którego ucznia</label>
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="field-row">
        <div>
          <label>Kwota (PLN)</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus placeholder="810" />
        </div>
        <div>
          <label>Data wpłaty</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div>
        <label>Kto zapłacił (opcjonalnie)</label>
        <input value={payer} onChange={(e) => setPayer(e.target.value)} placeholder="np. Pani Monika" />
      </div>
      <div>
        <label>Notatka (opcjonalnie)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="np. gotówka, za czerwiec" />
      </div>
      {payer && sName && (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Zapis: {payer} zapłaciła {amount ? fmtMoney(Number(amount)) : "—"} za {sName}. Wejdzie do podsumowania.
        </p>
      )}
    </Modal>
  );
}

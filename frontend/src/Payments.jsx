import { useState, useEffect, useCallback, useId } from "react";
import { api } from "./api";
import Modal from "./Modal";
import { fmtMoney } from "./dates";
import { useConfirm } from "./Confirm";

export default function Payments({ students, reload }) {
  const confirm = useConfirm();
  const [payments, setPayments] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  // Single entry point, same reason as in Students: two loaders invite the bug
  // where a mutation refreshes one of them and silently leaves the other stale.
  const refresh = useCallback(async () => {
    setPayments(await api.listPayments());
    reload();          // students and the summary live in the parent
  }, [reload]);

  useEffect(() => { refresh(); }, [refresh]);

  async function remove(p) {
    const ok = await confirm({
      title: "Usunąć wpłatę?",
      message: `Wpłata ${fmtMoney(p.amount)} z dnia ${p.date} zostanie usunięta.`,
      consequence: "Saldo ucznia zmieni się natychmiast. Operacji nie da się cofnąć.",
      confirmLabel: "Usuń wpłatę",
    });
    if (!ok) return;
    await api.deletePayment(p.id);
    refresh();
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
                  <td className="num">
                    <button className="ghost" onClick={() => setEditing(p)}>Edytuj</button>
                    <button className="ghost danger" onClick={() => remove(p)}>Usuń</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <PaymentEditForm
          payment={editing}
          studentName={students.find((s) => s.id === editing.student_id)?.name}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}

      {showForm && (
        <PaymentForm
          students={students}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); refresh(); }}
        />
      )}
    </div>
  );
}

function PaymentForm({ students, onClose, onSaved }) {
  const uid = useId();
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
        <label htmlFor={`${uid}-za-ktorego-ucznia-1`}>Za którego ucznia</label>
        <select id={`${uid}-za-ktorego-ucznia-1`} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="field-row">
        <div>
          <label htmlFor={`${uid}-kwota-pln-2`}>Kwota (PLN)</label>
          <input id={`${uid}-kwota-pln-2`} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus placeholder="810" />
        </div>
        <div>
          <label htmlFor={`${uid}-data-wpaty-3`}>Data wpłaty</label>
          <input id={`${uid}-data-wpaty-3`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div>
        <label htmlFor={`${uid}-kto-zapaci-opcjonalnie-4`}>Kto zapłacił (opcjonalnie)</label>
        <input id={`${uid}-kto-zapaci-opcjonalnie-4`} value={payer} onChange={(e) => setPayer(e.target.value)} placeholder="np. Pani Monika" />
      </div>
      <div>
        <label htmlFor={`${uid}-notatka-opcjonalnie-5`}>Notatka (opcjonalnie)</label>
        <input id={`${uid}-notatka-opcjonalnie-5`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="np. gotówka, za czerwiec" />
      </div>
      {payer && sName && (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Zapis: {payer} zapłaciła {amount ? fmtMoney(Number(amount)) : "—"} za {sName}. Wejdzie do podsumowania.
        </p>
      )}
    </Modal>
  );
}

function PaymentEditForm({ payment, studentName, onClose, onSaved }) {
  const uid = useId();
  const [amount, setAmount] = useState(payment.amount);
  const [date, setDate] = useState(payment.date);
  const [payer, setPayer] = useState(payment.payer || "");
  const [note, setNote] = useState(payment.note || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!amount) return;
    setBusy(true);
    try {
      await api.updatePayment(payment.id, {
        amount: Number(amount),
        date,
        payer: payer || null,
        note: note || null,
      });
      onSaved();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Edycja wpłaty"
      onClose={onClose}
      footer={<>
        <button onClick={onClose}>Anuluj</button>
        <button className="primary" onClick={save} disabled={busy || !amount}>Zapisz</button>
      </>}
    >
      {err && <div className="err">{err}</div>}

      <p className="muted" style={{ marginTop: 0 }}>
        Wpłata ucznia <strong>{studentName || "—"}</strong>.
      </p>

      <div className="field-row">
        <div>
          <label htmlFor={`${uid}-amount`}>Kwota (PLN)</label>
          <input id={`${uid}-amount`} type="number" step="0.01" value={amount}
                 onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${uid}-date`}>Data</label>
          <input id={`${uid}-date`} type="date" value={date}
                 onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div>
        <label htmlFor={`${uid}-payer`}>Od kogo</label>
        <input id={`${uid}-payer`} value={payer} onChange={(e) => setPayer(e.target.value)}
               placeholder="np. mama Kasi, przelew" />
      </div>

      <div>
        <label htmlFor={`${uid}-note`}>Notatka</label>
        <textarea id={`${uid}-note`} rows={2} value={note}
                  onChange={(e) => setNote(e.target.value)} />
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        Ucznia nie da się tu zmienić — przeniesienie wpłaty między uczniami
        zmienia dwa salda naraz, więc usuń ją i wprowadź na nowo, żeby zostało
        to widoczne w historii.
      </p>
    </Modal>
  );
}

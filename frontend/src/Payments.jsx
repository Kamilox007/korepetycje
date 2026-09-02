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
  const [studentFilter, setStudentFilter] = useState("");
  const [tutorFilter, setTutorFilter] = useState("");

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

  const tutorOptions = [];
  const seenTutors = new Set();
  for (const p of payments) {
    const key = p.assigned_tutor_id ?? "brak";
    if (seenTutors.has(key)) continue;
    seenTutors.add(key);
    tutorOptions.push({ key, name: p.assigned_tutor_id ? p.tutor_name : "nieprzypisane" });
  }

  const filtered = payments
    .filter((p) => !studentFilter || String(p.student_id) === studentFilter)
    .filter((p) => !tutorFilter || String(p.assigned_tutor_id ?? "brak") === tutorFilter);

  return (
    <div>
      <div className="page-head">
        <h1>Płatności</h1>
        <button className="primary" onClick={() => setShowForm(true)}>+ Dodaj wpłatę</button>
      </div>

      {payments.length > 0 && (
        <div className="cal-head" style={{ marginBottom: 12 }}>
          <select aria-label="Filtruj po uczniu" value={studentFilter} onChange={(e) => setStudentFilter(e.target.value)} style={{ width: "auto" }}>
            <option value="">Wszyscy uczniowie</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select aria-label="Filtruj po korepetytorze" value={tutorFilter} onChange={(e) => setTutorFilter(e.target.value)} style={{ width: "auto" }}>
            <option value="">Wszyscy korepetytorzy</option>
            {tutorOptions.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
        </div>
      )}

      <div className="card">
        {payments.length === 0 ? (
          <div className="empty">
            <p>Brak zarejestrowanych wpłat.</p>
            <button className="primary" onClick={() => setShowForm(true)}>Dodaj pierwszą wpłatę</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty"><p>Brak wpłat spełniających wybrane filtry.</p></div>
        ) : (
          <table>
            <thead>
              <tr><th>Data</th><th>Uczeń</th><th>Korepetytor</th><th>Od kogo</th><th>Notatka</th><th className="num">Kwota</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td className="muted">{p.date}</td>
                  <td style={{ fontWeight: 500 }}>{p.student_name}</td>
                  <td className={p.assigned_tutor_id ? "muted" : undefined} style={p.assigned_tutor_id ? undefined : { color: "var(--due)" }}>
                    {p.assigned_tutor_id ? p.tutor_name : "nieprzypisane"}
                  </td>
                  <td>{p.payer || "-"}</td>
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

/** Every tutor in the practice — always offered, so staff can credit a
 *  payment to anyone, not just someone this student happens to have a
 *  correctly-tagged lesson record with. Narrower, lesson-derived lists kept
 *  producing gaps: no completed lesson yet, no lesson at all yet, or a
 *  lesson that was simply never assigned a tutor — every one of them made
 *  the picker unusable right when it was needed. */
function useAllTutors() {
  const [tutors, setTutors] = useState([]);
  useEffect(() => {
    api.listTutors().then(setTutors).catch(() => setTutors([]));
  }, []);
  return tutors;
}

/** This student's lesson history — used only to suggest a default and to
 *  show a "zalega" balance hint next to each option, never to restrict which
 *  tutor can be picked. */
function useSuggestedTutors(studentId) {
  const [suggested, setSuggested] = useState([]);
  useEffect(() => {
    if (!studentId) { setSuggested([]); return; }
    Promise.all([
      api.listLessons({ studentId }),
      api.summary().catch(() => null),
    ])
      .then(([lessons, summary]) => {
        const balances = new Map();
        const row = summary?.students.find((r) => r.student_id === Number(studentId));
        for (const t of row?.by_tutor || []) {
          if (t.tutor_id) balances.set(t.tutor_id, t.balance);
        }
        const seen = new Map();
        for (const l of lessons) {
          if (!l.assigned_tutor_id || seen.has(l.assigned_tutor_id)) continue;
          seen.set(l.assigned_tutor_id, { tutor_id: l.assigned_tutor_id, balance: balances.get(l.assigned_tutor_id) ?? 0 });
        }
        setSuggested([...seen.values()]);
      })
      .catch(() => setSuggested([]));
  }, [studentId]);
  return suggested;
}

function PaymentForm({ students, onClose, onSaved }) {
  const uid = useId();
  const [studentId, setStudentId] = useState(students[0]?.id || "");
  const [amount, setAmount] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [payer, setPayer] = useState("");
  const [note, setNote] = useState("");
  const [tutorId, setTutorId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const allTutors = useAllTutors();
  const suggested = useSuggestedTutors(studentId);
  const suggestedBalance = new Map(suggested.map((t) => [t.tutor_id, t.balance]));

  if (!students.length) {
    return <Modal title="Brak uczniów" onClose={onClose}><p>Najpierw dodaj ucznia.</p></Modal>;
  }

  // Default to the one tutor this student's lessons point to, when there is
  // exactly one — otherwise leave it for staff to pick. Also covers a
  // student change: suggested briefly empties and repopulates for the new
  // student, re-running this.
  useEffect(() => {
    setTutorId(suggested.length === 1 ? String(suggested[0].tutor_id) : "");
  }, [studentId, suggested]);

  async function save() {
    if (!amount) return;
    if (!tutorId) return;
    setBusy(true);
    setErr("");
    try {
      await api.createPayment({
        student_id: Number(studentId),
        amount: Number(amount),
        date,
        payer: payer || null,
        note: note || null,
        assigned_tutor_id: tutorId ? Number(tutorId) : null,
      });
      onSaved();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  const sName = students.find((s) => s.id === Number(studentId))?.name;

  return (
    <Modal
      title="Nowa wpłata"
      onClose={onClose}
      footer={<>
        <button onClick={onClose}>Anuluj</button>
        <button className="primary" onClick={save} disabled={busy || !amount || !tutorId}>Zapisz</button>
      </>}
    >
      {err && <div className="err">{err}</div>}

      <div>
        <label htmlFor={`${uid}-za-ktorego-ucznia-1`}>Za którego ucznia</label>
        <select id={`${uid}-za-ktorego-ucznia-1`} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor={`${uid}-tutor`}>Dla którego korepetytora</label>
        <select id={`${uid}-tutor`} value={tutorId} onChange={(e) => setTutorId(e.target.value)}>
          <option value="">- wybierz -</option>
          {allTutors.map((t) => (
            <option key={t.id} value={t.id}>
              {t.display_name}{suggestedBalance.get(t.id) < 0 ? ` (zalega ${(-suggestedBalance.get(t.id)).toFixed(2)} zł)` : ""}
            </option>
          ))}
        </select>
        {suggested.length > 1 && (
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Uczeń ma zajęcia u kilku osób - wybierz komu wpłata ma być zaliczona,
            inaczej nie pomniejszy niczyjego salda.
          </p>
        )}
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
          Zapis: {payer} zapłaciła {amount ? fmtMoney(Number(amount)) : "-"} za {sName}. Wejdzie do podsumowania.
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
  const [tutorId, setTutorId] = useState(payment.assigned_tutor_id ? String(payment.assigned_tutor_id) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const allTutors = useAllTutors();

  async function save() {
    if (!amount) return;
    setBusy(true);
    try {
      await api.updatePayment(payment.id, {
        amount: Number(amount),
        date,
        payer: payer || null,
        note: note || null,
        assigned_tutor_id: tutorId ? Number(tutorId) : null,
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
        Wpłata ucznia <strong>{studentName || "-"}</strong>.
      </p>

      <div>
        <label htmlFor={`${uid}-tutor`}>Dla którego korepetytora</label>
        <select id={`${uid}-tutor`} value={tutorId} onChange={(e) => setTutorId(e.target.value)}>
          <option value="">— nieprzypisane —</option>
          {allTutors.map((t) => (
            <option key={t.id} value={t.id}>{t.display_name}</option>
          ))}
        </select>
        {!payment.assigned_tutor_id && (
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Ta wpłata nie jest przypisana do żadnego korepetytora i nie
            pomniejsza niczyjego salda — wybierz komu ją zaliczyć.
          </p>
        )}
      </div>

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
        Ucznia nie da się tu zmienić - przeniesienie wpłaty między uczniami
        zmienia dwa salda naraz, więc usuń ją i wprowadź na nowo, żeby zostało
        to widoczne w historii.
      </p>
    </Modal>
  );
}

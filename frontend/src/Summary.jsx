import { useState, useEffect, useCallback, Fragment, useId } from "react";
import { api } from "./api";
import Modal from "./Modal";
import { fmtMoney } from "./dates";
import { useConfirm } from "./Confirm";

export default function Summary({ refreshKey, tutorView = false, myRole }) {
  const [data, setData] = useState(null);
  const [payments, setPayments] = useState(null);
  const [myLimit, setMyLimit] = useState(null);
  const [limits, setLimits] = useState(null);
  const [showLimitManager, setShowLimitManager] = useState(false);
  const [limitsKey, setLimitsKey] = useState(0);
  // Students whose payment list is unfolded in "Wpłaty wg ucznia".
  const [openStudents, setOpenStudents] = useState(() => new Set());

  useEffect(() => {
    // A tutor gets their own students and their own figures only; the endpoint
    // filters rather than the view hiding columns.
    (tutorView ? api.tutorSummary() : api.summary()).then(setData).catch(() => setData(null));
  }, [refreshKey, tutorView]);

  useEffect(() => {
    if (!tutorView) return;
    api.tutorPayments().then(setPayments).catch(() => setPayments([]));
  }, [refreshKey, tutorView]);

  useEffect(() => {
    if (!tutorView) return;
    api.myQuarterlyLimit().then(setMyLimit).catch(() => setMyLimit(null));
  }, [refreshKey, tutorView, limitsKey]);

  useEffect(() => {
    if (tutorView) return;
    api.quarterlyLimits().then(setLimits).catch(() => setLimits([]));
  }, [refreshKey, tutorView, limitsKey]);

  if (!data) return <div className="empty">Ładowanie…</div>;

  // One line per student with the total; the individual payments unfold on
  // click. Summing in grosze, not zloty floats - the same reason the backend
  // stores amounts as integers.
  const byStudent = new Map();
  for (const p of payments || []) {
    if (!byStudent.has(p.student_id)) {
      byStudent.set(p.student_id, { name: p.student_name || "—", rows: [], totalGrosze: 0 });
    }
    const g = byStudent.get(p.student_id);
    g.rows.push(p);
    g.totalGrosze += Math.round(p.amount * 100);
  }
  const toggleStudent = (id) => setOpenStudents((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Every tutor with their own students and each one's saldo, across the
  // whole practice rather than just the per-student split — a tutor's own
  // view is already scoped to themselves, so this is staff-only.
  const tutorTotals = new Map();
  if (!tutorView) {
    for (const s of data.students) {
      for (const t of s.by_tutor || []) {
        const key = t.tutor_id ?? "brak";
        if (!tutorTotals.has(key)) {
          tutorTotals.set(key, { name: t.tutor_name || "nieprzypisane", balance: 0, students: [] });
        }
        const agg = tutorTotals.get(key);
        agg.balance += t.balance;
        agg.students.push({ id: s.student_id, name: s.student_name, balance: t.balance });
      }
    }
    for (const agg of tutorTotals.values()) {
      agg.students.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  return (
    <div>
      <div className="page-head"><h1>Podsumowanie</h1></div>

      <div className="metrics">
        <div className="metric">
          <div className="label">Saldo</div>
          <div className={`value ${data.total_balance >= 0 ? "pos" : "neg"}`}>
            {fmtMoney(data.total_balance)}
          </div>
        </div>
      </div>

      <div className="card">
        {data.students.length === 0 ? (
          <div className="empty"><p>Brak danych. Dodaj uczniów i zajęcia.</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Uczeń</th>
                <th className="num">Zajęcia</th>
                <th className="num">Odbyte</th>
                <th className="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => {
                // Split rows only when there is something to split: a student
                // taught by one person needs no breakdown.
                const split = (s.by_tutor || []).length > 1 ? s.by_tutor : [];
                return (
                  <Fragment key={s.student_id}>
                    <tr>
                      <td style={{ fontWeight: 500 }}>{s.student_name}</td>
                      <td className="num">{s.lessons_total}</td>
                      <td className="num">{s.lessons_completed}</td>
                      <td className="num">
                        <BalanceBadge value={s.balance} />
                      </td>
                    </tr>
                    {split.map((t) => (
                      <tr key={`${s.student_id}-${t.tutor_id ?? "brak"}`} className="sub-row">
                        <td className="muted" style={{ paddingLeft: 24 }}>
                          {t.tutor_name || "nieprzypisane"}
                        </td>
                        <td className="num" />
                        <td className="num" />
                        <td className="num">
                          <BalanceBadge value={t.balance} />
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        Saldo dodatnie = nadpłata / zaliczka. Saldo ujemne = uczeń zalega z płatnością za odbyte zajęcia.
      </p>

      {!tutorView && tutorTotals.size > 0 && (
        <>
          <div className="page-head" style={{ marginTop: 32 }}><h2 style={{ margin: 0 }}>Saldo wg korepetytora</h2></div>
          <div className="card">
            <table>
              <thead>
                <tr><th>Korepetytor / Uczeń</th><th className="num">Saldo</th></tr>
              </thead>
              <tbody>
                {[...tutorTotals.entries()].map(([key, t]) => (
                  <Fragment key={key}>
                    <tr>
                      <td style={{ fontWeight: 500 }}>{t.name}</td>
                      <td className="num">
                        <BalanceBadge value={t.balance} />
                      </td>
                    </tr>
                    {t.students.map((st) => (
                      <tr key={`${key}-${st.id}`} className="sub-row">
                        <td className="muted" style={{ paddingLeft: 24 }}>{st.name}</td>
                        <td className="num">
                          <BalanceBadge value={st.balance} />
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!tutorView && limits && limits.length > 0 && (
        <>
          <div className="page-head" style={{ marginTop: 32 }}>
            <h2 style={{ margin: 0 }}>{limits[0].quarter_label} — limit kwartalny</h2>
            {myRole === "admin" && (
              <button className="ghost" onClick={() => setShowLimitManager(true)}>Zarządzaj limitem</button>
            )}
          </div>
          <div className="card">
            <table>
              <thead>
                <tr><th>Korepetytor</th><th className="num">Zarobiono</th><th className="num">Limit</th><th className="num">Pozostało</th></tr>
              </thead>
              <tbody>
                {limits.map((l) => (
                  <tr key={l.tutor_id}>
                    <td style={{ fontWeight: 500 }}>{l.tutor_name}</td>
                    <td className="num">{fmtMoney(l.earned)}</td>
                    <td className="num">{l.limit != null ? fmtMoney(l.limit) : <span className="muted">brak</span>}</td>
                    <td className="num">
                      {l.remaining != null ? (
                        <BalanceBadge value={l.remaining} />
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showLimitManager && (
        <IncomeLimitManager
          onClose={() => setShowLimitManager(false)}
          onChanged={() => setLimitsKey((k) => k + 1)}
        />
      )}

      {tutorView && myLimit && (
        <>
          <div className="page-head" style={{ marginTop: 32 }}><h2 style={{ margin: 0 }}>{myLimit.quarter_label} — limit kwartalny</h2></div>
          <div className="card">
            {myLimit.limit == null ? (
              <p className="muted" style={{ margin: 0 }}>
                Administrator nie ustawił jeszcze limitu na ten kwartał.
              </p>
            ) : (
              <>
                <div className="metrics" style={{ marginBottom: 12 }}>
                  <div className="metric">
                    <div className="label">Zarobiono</div>
                    <div className="value">{fmtMoney(myLimit.earned)}</div>
                  </div>
                  <div className="metric">
                    <div className="label">Limit</div>
                    <div className="value">{fmtMoney(myLimit.limit)}</div>
                  </div>
                  <div className="metric">
                    <div className="label">Pozostało</div>
                    <div className={`value ${myLimit.remaining >= 0 ? "pos" : "neg"}`}>
                      {fmtMoney(myLimit.remaining)}
                    </div>
                  </div>
                </div>
                <LimitProgressBar earned={myLimit.earned} limit={myLimit.limit} />
              </>
            )}
          </div>
        </>
      )}

      {tutorView && payments && payments.length > 0 && (
        <>
          <div className="page-head" style={{ marginTop: 32 }}><h2 style={{ margin: 0 }}>Wpłaty wg ucznia</h2></div>
          <div className="card">
            <table>
              <thead>
                <tr><th>Uczeń</th><th>Wpłat</th><th>Ostatnia</th><th className="num">Razem</th></tr>
              </thead>
              <tbody>
                {[...byStudent.entries()].map(([studentId, g]) => {
                  const open = openStudents.has(studentId);
                  return (
                    <Fragment key={studentId}>
                      <tr className="row-toggle" onClick={() => toggleStudent(studentId)}
                          aria-expanded={open}>
                        <td style={{ fontWeight: 500 }}>
                          <span className="row-toggle-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
                          {g.name}
                        </td>
                        <td className="muted">{g.rows.length}</td>
                        <td className="muted">{g.rows[0].date}</td>
                        <td className="num" style={{ fontWeight: 600, color: "var(--done)" }}>{fmtMoney(g.totalGrosze / 100)}</td>
                      </tr>
                      {open && g.rows.map((p) => (
                        <tr key={p.id} className="row-detail">
                          <td></td>
                          <td className="muted" colSpan={2}>
                            {p.date}{p.payer ? ` · ${p.payer}` : ""}{p.note ? ` · ${p.note}` : ""}
                          </td>
                          <td className="num">{fmtMoney(p.amount)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// Green for a credit (or zero), red for money owed - the same reading everywhere.
function BalanceBadge({ value }) {
  return <span className={`badge ${value >= 0 ? "done" : "due"}`}>{fmtMoney(value)}</span>;
}

function LimitProgressBar({ earned, limit }) {
  const pct = limit > 0 ? Math.min(100, (earned / limit) * 100) : 0;
  const over = earned > limit;
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${pct}%`, background: over ? "var(--due)" : "var(--done)" }} />
    </div>
  );
}

function IncomeLimitManager({ onClose, onChanged }) {
  const uid = useId();
  const confirm = useConfirm();
  const [settings, setSettings] = useState(null);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    api.incomeLimits().then(setSettings).catch(() => setSettings([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!effectiveFrom || !amount) return;
    setBusy(true);
    setErr("");
    try {
      await api.addIncomeLimit({ effective_from: effectiveFrom, limit: Number(amount) });
      setEffectiveFrom("");
      setAmount("");
      load();
      onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(s) {
    const ok = await confirm({
      title: "Usunąć limit?",
      message: `Limit ${fmtMoney(s.limit)} obowiązujący od ${s.effective_from} zostanie usunięty.`,
      consequence: "Od tej daty będzie obowiązywał poprzedni wpis, a jeśli go nie ma - brak limitu.",
      confirmLabel: "Usuń limit",
    });
    if (!ok) return;
    try {
      await api.deleteIncomeLimit(s.id);
      load();
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <Modal
      title="Limit kwartalny"
      onClose={onClose}
      footer={<>
        <button onClick={onClose}>Zamknij</button>
        <button className="primary" onClick={save} disabled={busy || !effectiveFrom || !amount}>Zapisz</button>
      </>}
    >
      {err && <div className="err">{err}</div>}

      <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
        Wartość obowiązuje od podanej daty aż do kolejnego wpisu — dopisz nową
        stawkę z wyprzedzeniem, gdy pozna się nową kwotę (np. od 1 stycznia).
      </p>

      {settings && settings.length > 0 && (
        <table style={{ marginBottom: 16 }}>
          <thead><tr><th>Obowiązuje od</th><th className="num">Kwota</th><th></th></tr></thead>
          <tbody>
            {settings.map((s) => (
              <tr key={s.id}>
                <td>{s.effective_from}</td>
                <td className="num">{fmtMoney(s.limit)}</td>
                <td className="num"><button className="ghost danger" onClick={() => remove(s)}>Usuń</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="field-row">
        <div>
          <label htmlFor={`${uid}-from`}>Obowiązuje od</label>
          <input id={`${uid}-from`} type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${uid}-amount`}>Kwota (PLN)</label>
          <input id={`${uid}-amount`} type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10813.50" />
        </div>
      </div>
    </Modal>
  );
}

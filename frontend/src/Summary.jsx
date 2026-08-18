import { useState, useEffect, Fragment } from "react";
import { api } from "./api";
import { fmtMoney } from "./dates";

export default function Summary({ refreshKey, tutorView = false }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    // A tutor gets their own students and their own figures only; the endpoint
    // filters rather than the view hiding columns.
    (tutorView ? api.tutorSummary() : api.summary()).then(setData).catch(() => setData(null));
  }, [refreshKey, tutorView]);

  if (!data) return <div className="empty">Ładowanie…</div>;

  return (
    <div>
      <div className="page-head"><h1>Podsumowanie</h1></div>

      <div className="metrics">
        <div className="metric">
          <div className="label">Należność za odbyte zajęcia</div>
          <div className="value">{fmtMoney(data.total_due)}</div>
        </div>
        <div className="metric">
          <div className="label">Wpłacono łącznie</div>
          <div className="value">{fmtMoney(data.total_paid)}</div>
        </div>
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
                <th className="num">Należność</th>
                <th className="num">Wpłacono</th>
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
                      <td className="num">{fmtMoney(s.amount_due)}</td>
                      <td className="num">{fmtMoney(s.amount_paid)}</td>
                      <td className="num">
                        <span className={`badge ${s.balance >= 0 ? "done" : "due"}`}>
                          {fmtMoney(s.balance)}
                        </span>
                      </td>
                    </tr>
                    {split.map((t) => (
                      <tr key={`${s.student_id}-${t.tutor_id ?? "brak"}`} className="sub-row">
                        <td className="muted" style={{ paddingLeft: 24 }}>
                          {t.tutor_name || "nieprzypisane"}
                        </td>
                        <td className="num" />
                        <td className="num" />
                        <td className="num muted">{fmtMoney(t.amount_due)}</td>
                        <td className="num muted">{fmtMoney(t.amount_paid)}</td>
                        <td className="num">
                          <span className={`badge ${t.balance >= 0 ? "done" : "due"}`}>
                            {fmtMoney(t.balance)}
                          </span>
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
    </div>
  );
}

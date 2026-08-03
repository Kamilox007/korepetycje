import { useState, useEffect } from "react";
import { api } from "./api";
import { fmtMoney } from "./dates";

export default function Summary({ refreshKey }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.summary().then(setData);
  }, [refreshKey]);

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
              {data.students.map((s) => (
                <tr key={s.student_id}>
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
              ))}
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

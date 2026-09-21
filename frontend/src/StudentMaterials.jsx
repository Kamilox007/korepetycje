import { useEffect, useState } from "react";
import { api } from "./api";
import { fmtBytes } from "./StudentFiles";
import { fmtDate } from "./dates";

/**
 * Panel ucznia: tablice przypisane do niego i materiały (PDF) od korepetytora.
 *
 * Tablica otwiera się tym samym linkiem, który uczeń dostał na komunikator -
 * dostęp daje token w linku, ta lista tylko oszczędza szukania go w
 * wiadomościach. Materiały są tylko do odczytu; dodaje je korepetytor.
 */
export default function StudentMaterials() {
  const [boards, setBoards] = useState(null);
  const [files, setFiles] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([api.myBoards(), api.myFiles()])
      .then(([b, f]) => { setBoards(b); setFiles(f); })
      .catch((e) => { setErr(e.message); setBoards([]); setFiles([]); });
  }, []);

  if (boards === null || files === null) return <div className="empty">Ładowanie…</div>;

  return (
    <div>
      <div className="page-head"><h1>Tablice i materiały</h1></div>
      {err && <div className="err">{err}</div>}

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Tablice</h2>
      <div className="card" style={{ marginBottom: 24 }}>
        {boards.length === 0 ? (
          <div className="empty"><p>Nie masz jeszcze żadnej tablicy. Dostaniesz link od korepetytora.</p></div>
        ) : (
          <table>
            <thead><tr><th>Tablica</th><th className="num">Strony</th><th>Ostatnia zmiana</th><th></th></tr></thead>
            <tbody>
              {boards.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 500 }}>{b.title}</td>
                  <td className="num muted">{b.page_count}</td>
                  <td className="muted">{fmtDate(b.updated_at)}</td>
                  <td className="num">
                    <a className="btn-link" href={b.path} target="_blank" rel="noopener">Otwórz</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Materiały</h2>
      <div className="card">
        {files.length === 0 ? (
          <div className="empty"><p>Korepetytor nie dodał jeszcze żadnych materiałów.</p></div>
        ) : (
          <table>
            <thead><tr><th>Plik</th><th>Dodano</th><th className="num">Rozmiar</th><th></th></tr></thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td style={{ fontWeight: 500 }}>{f.name}</td>
                  <td className="muted">{fmtDate(f.created_at)}{f.uploaded_by_name ? ` · ${f.uploaded_by_name}` : ""}</td>
                  <td className="num muted">{fmtBytes(f.bytes)}</td>
                  <td className="num">
                    <a className="btn-link" href={api.myFileUrl(f.id)} target="_blank" rel="noopener">Otwórz</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

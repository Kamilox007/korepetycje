import { useState, useEffect, useCallback } from "react";
import { api } from "./api";
import Modal from "./Modal";
import { useConfirm } from "./Confirm";

export default function CalendarExportModal({ onClose }) {
  const confirm = useConfirm();
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    api.calendarFeed()
      .then((r) => setUrl(`${window.location.origin}${r.path}`))
      .catch((e) => setErr(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function regenerate() {
    const ok = await confirm({
      title: "Wygenerować nowy link?",
      message: "Dotychczasowy link przestanie działać.",
      consequence: "Subskrypcja dodana w Google Calendar pod starym adresem przestanie się aktualizować - trzeba będzie dodać kalendarz ponownie, z nowym adresem.",
      confirmLabel: "Wygeneruj nowy link",
    });
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      await api.regenerateCalendarFeed();
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard permissions can be denied; the field itself is selectable as a fallback
    }
  }

  return (
    <Modal
      title="Eksport do Google Calendar"
      onClose={onClose}
      footer={<button onClick={onClose}>Zamknij</button>}
    >
      {err && <div className="err">{err}</div>}

      <p className="muted" style={{ marginTop: 0 }}>
        Ten adres pokazuje Twoje zajęcia z panelu jako kalendarz do subskrypcji.
        Nowe zajęcia, zmiany terminu i odwołania pojawią się w Google Calendar
        same - Google sam odświeża taki kalendarz, zwykle co kilkanaście-
        kilkadziesiąt godzin (bez możliwości przyspieszenia tego z naszej strony).
      </p>

      {url ? (
        <>
          <div className="field-row" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="cal-feed-url">Adres kalendarza</label>
              <input id="cal-feed-url" readOnly value={url} onFocus={(e) => e.target.select()} />
            </div>
            <button onClick={copy} style={{ marginBottom: 1 }}>{copied ? "Skopiowano" : "Kopiuj"}</button>
          </div>

          <p className="muted" style={{ fontSize: 12 }}>
            Traktuj ten adres jak hasło - każdy, kto go ma, zobaczy Twój terminarz.
          </p>

          <ol style={{ fontSize: 13 }}>
            <li>Otwórz Google Calendar na komputerze.</li>
            <li>Po lewej stronie, przy „Inne kalendarze", kliknij + i wybierz „Z adresu URL".</li>
            <li>Wklej powyższy adres i kliknij „Dodaj kalendarz".</li>
          </ol>

          <button className="ghost danger" onClick={regenerate} disabled={busy}>
            Wygeneruj nowy link
          </button>
        </>
      ) : (
        !err && <p className="muted">Ładowanie…</p>
      )}
    </Modal>
  );
}

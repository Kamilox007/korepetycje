import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api } from "./api";
import { fmtMoney } from "./dates";

/**
 * Bank details plus a scannable transfer code for the student panel.
 *
 * The code follows the ZBP "2D" recommendation, which Polish banking apps read
 * to pre-fill a transfer. Nothing is charged automatically: the payer confirms
 * in their own bank. What it removes is the retyping, and with it the wrong
 * transfer titles that make payments hard to match to a student.
 *
 * Renders nothing when the bank account is not configured, so an installation
 * without one simply does not show the section.
 */
export default function TransferQR() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    api.myTransferInfo().then(setInfo).catch(() => setInfo({ configured: false }));
  }, []);

  if (!info || !info.configured || !info.targets.length) return null;

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h3 style={{ marginTop: 0 }}>Zapłać przelewem</h3>
      {info.targets.length > 1 && (
        <p className="muted" style={{ marginTop: 0 }}>
          Masz zajęcia u {info.targets.length} korepetytorów - każdy ma własny
          rachunek, więc płatności są osobne.
        </p>
      )}
      {info.targets.map((t) => (
        <TransferTarget key={t.tutor_id ?? "brak"} target={t}
                        showRecipient={info.targets.length > 1} />
      ))}
      <p className="muted transfer-note">
        Zachowaj tytuł bez zmian - po nim rozpoznajemy, czyja to wpłata.
        Zaksięgowanie zajmuje zwykle jeden dzień roboczy.
      </p>
    </div>
  );
}

function TransferTarget({ target, showRecipient }) {
  const [copied, setCopied] = useState("");
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!target.qr_payload || !canvasRef.current) return;
    // Error correction L and a 4-module quiet zone are what the recommendation
    // specifies; a denser correction level makes the code harder to scan from
    // a phone screen without buying anything in return.
    QRCode.toCanvas(canvasRef.current, target.qr_payload, {
      width: 220,
      margin: 4,
      errorCorrectionLevel: "L",
      color: { dark: "#16181c", light: "#ffffff" },
    }).catch(() => {});
  }, [target]);

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 1500);
    } catch { /* clipboard blocked, the value is visible anyway */ }
  }

  return (
    <section className="transfer-target">
      {showRecipient && <h4 className="transfer-heading">{target.recipient}</h4>}

      {target.amount ? (
        <p className="muted" style={{ marginTop: 0 }}>
          Do zapłaty: <strong style={{ color: "var(--due)" }}>{fmtMoney(target.amount)}</strong>
        </p>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>
          Brak zaległości. Kod pozwala wpłacić dowolną kwotę - aplikacja banku
          poprosi o jej podanie.
        </p>
      )}

      <div className="transfer-row">
        {target.qr_payload && (
          <figure className="transfer-qr">
            <canvas ref={canvasRef} aria-label="Kod QR przelewu" />
            <figcaption className="muted">
              Zeskanuj w aplikacji banku — poszukaj opcji „Skanuj i płać”
              albo „Zapłać kodem QR”.
            </figcaption>
          </figure>
        )}

        <dl className="transfer-details">
          <dt>Odbiorca</dt>
          <dd>{target.recipient}</dd>

          {target.account && (
            <>
              <dt>Numer rachunku</dt>
              <dd>
                <span className="transfer-value num">{target.account}</span>
                <button onClick={() => copy(target.account.replace(/\s/g, ""), "konto")}>
                  {copied === "konto" ? "Skopiowano ✓" : "Kopiuj"}
                </button>
              </dd>
            </>
          )}

          {target.account && (
            <>
              <dt>Tytuł przelewu</dt>
              <dd>
                <span className="transfer-value">{target.title}</span>
                <button onClick={() => copy(target.title, "tytul")}>
                  {copied === "tytul" ? "Skopiowano ✓" : "Kopiuj"}
                </button>
              </dd>
            </>
          )}

          {target.phone && (
            <>
              <dt>BLIK na numer</dt>
              <dd>
                <span className="transfer-value num">{target.phone}</span>
                <button onClick={() => copy(target.phone.replace(/\s/g, ""), "telefon")}>
                  {copied === "telefon" ? "Skopiowano ✓" : "Kopiuj"}
                </button>
              </dd>
            </>
          )}
        </dl>
      </div>
    </section>
  );
}

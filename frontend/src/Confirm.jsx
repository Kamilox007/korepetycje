import { createContext, useCallback, useContext, useRef, useState, useId } from "react";
import Modal from "./Modal";

/**
 * Potwierdzenia operacji nieodwracalnych.
 *
 * Zastępuje natywne confirm(), które wygląda obco, na telefonie wyskakuje jako
 * alert systemowy, a przede wszystkim daje się wyłączyć w przeglądarce —
 * wtedy zwraca false i operacja po cichu przestaje działać.
 *
 * Użycie:
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Usunąć?", message: "..." }))) return;
 */
const ConfirmContext = createContext(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm wymaga ConfirmProvider");
  return ctx;
}

export function ConfirmProvider({ children }) {
  const uid = useId();
  const [req, setReq] = useState(null);
  const [typed, setTyped] = useState("");
  const resolveRef = useRef(null);

  const confirm = useCallback((options) => {
    setTyped("");
    setReq(options);
    return new Promise((resolve) => { resolveRef.current = resolve; });
  }, []);

  function close(result) {
    setReq(null);
    setTyped("");
    if (resolveRef.current) {
      resolveRef.current(result);
      resolveRef.current = null;
    }
  }

  // Przy operacjach naprawdę nieodwracalnych żądamy przepisania nazwy.
  // Kliknięcie „tak” z rozpędu jest łatwe; przepisanie nazwiska ucznia
  // wymaga świadomego spojrzenia na to, co się kasuje.
  const wymagaWpisania = Boolean(req?.requireText);
  const potwierdzone = !wymagaWpisania || typed.trim() === req.requireText;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {req && (
        <Modal
          className="overlay-confirm"
          title={req.title || "Potwierdź"}
          onClose={() => close(false)}
          footer={
            <>
              <button onClick={() => close(false)}>Anuluj</button>
              <button
                className={req.danger === false ? "" : "danger"}
                disabled={!potwierdzone}
                onClick={() => close(true)}
              >
                {req.confirmLabel || "Usuń"}
              </button>
            </>
          }
        >
          <p style={{ margin: "0 0 4px" }}>{req.message}</p>

          {req.consequence && (
            <p className="muted" style={{ marginTop: 10 }}>{req.consequence}</p>
          )}

          {wymagaWpisania && (
            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor={`${uid}-aby-potwierdzic-wpisz-1`}>
                Aby potwierdzić, wpisz: <strong>{req.requireText}</strong>
              </label>
              <input id={`${uid}-aby-potwierdzic-wpisz-1`}
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && potwierdzone) close(true);
                }}
                placeholder={req.requireText}
              />
            </div>
          )}
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

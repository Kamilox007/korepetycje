import { createContext, useCallback, useContext, useRef, useState, useId } from "react";
import Modal from "./Modal";

/**
 * Confirmation dialogs for irreversible operations.
 *
 * Replaces the native confirm(), which looks out of place, appears as a system
 * alert on phones, and above all can be disabled in the browser: it then returns
 * false and the operation silently stops working.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Delete?", message: "..." }))) return;
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

  // For genuinely irreversible operations we require the name to be retyped.
  // Clicking "yes" on autopilot is easy; retyping a student's name forces a
  // deliberate look at what is being deleted.
  const requiresTyping = Boolean(req?.requireText);
  const confirmed = !requiresTyping || typed.trim() === req.requireText;

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
                disabled={!confirmed}
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

          {requiresTyping && (
            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor={`${uid}-aby-potwierdzic-wpisz-1`}>
                Aby potwierdzić, wpisz: <strong>{req.requireText}</strong>
              </label>
              <input id={`${uid}-aby-potwierdzic-wpisz-1`}
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && confirmed) close(true);
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

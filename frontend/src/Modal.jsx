import { useEffect, useRef } from "react";

export default function Modal({ title, onClose, children, footer, className = "" }) {
  // Whether the press that starts a click landed on the backdrop itself.
  //
  // A click event fires on the closest common ancestor of where the button went
  // down and where it came up. Selecting text in a field and releasing outside
  // the dialog therefore fires a click on the backdrop, which used to close the
  // dialog and throw away everything typed so far. Closing on mousedown alone
  // would be worse: a click that starts inside and ends outside is still not an
  // intent to dismiss.
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={`overlay ${className}`}
      onMouseDown={(e) => { pressedBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (!onClose) return;
        if (e.target !== e.currentTarget) return;   // click landed inside
        if (!pressedBackdrop.current) return;       // press started inside
        onClose();
      }}
    >
      <div className="modal">
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && <button className="ghost" onClick={onClose}>✕</button>}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

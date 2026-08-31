import { usePersistentState } from "./usePersistentState";

/**
 * A notice, not a consent banner: the one cookie this app sets
 * (korepetycje_session) is strictly necessary for staying logged in, which
 * exempts it from opt-in consent under Polish law (art. 173 ust. 3 Prawo
 * telekomunikacyjne) — there is nothing to accept or reject, only something
 * to disclose. See privacy-policy.html §8 for the full explanation.
 */
export default function CookieNotice() {
  const [dismissed, setDismissed] = usePersistentState("cookie_notice_dismissed", false);
  if (dismissed) return null;

  return (
    <div className="cookie-notice">
      <p>
        Serwis używa jednego niezbędnego pliku cookie, potrzebnego do
        utrzymania Twojej sesji zalogowania. Szczegóły w{" "}
        <a href="/privacy-policy.html" target="_blank" rel="noreferrer">Polityce Prywatności</a>.
      </p>
      <button className="primary" onClick={() => setDismissed(true)}>Rozumiem</button>
    </div>
  );
}

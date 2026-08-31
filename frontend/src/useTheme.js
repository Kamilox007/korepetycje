import { useEffect } from "react";
import { usePersistentState } from "./usePersistentState";

// null = follow the OS/browser preference (prefers-color-scheme in styles.css).
// "light" / "dark" = an explicit choice, applied via a data-theme attribute
// that the stylesheet gives priority over the media query either way.
export function useTheme() {
  const [theme, setTheme] = usePersistentState("theme", null);

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  const resolved = theme
    || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");

  function toggle() {
    setTheme(resolved === "dark" ? "light" : "dark");
  }

  return { theme: resolved, toggle };
}

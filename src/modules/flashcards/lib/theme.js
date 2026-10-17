// Theme handling for the flash-card settings.
//
// The rest of the app reads a single `dark` class on <html> (see the pre-paint
// script in index.html). That script only understands the localStorage "theme"
// key as "dark" / anything-else, so this helper stores the *resolved* value
// there while fc_settings keeps the user's actual choice ("light"/"dark"/
// "system"). That keeps the first paint flash-free for every choice.

export const THEMES = Object.freeze(["light", "dark", "system"]);

export const THEME_KEY = "theme";

export function systemPrefersDark() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// light -> false, dark -> true, system -> the OS preference.
export function resolveTheme(theme) {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return systemPrefersDark();
}

// Apply a theme to the document and remember the resolved value for the
// pre-paint script. Safe to call from SSR / tests (no-ops without a document).
export function applyTheme(theme, { persist = true } = {}) {
  if (typeof document === "undefined") return;
  const dark = resolveTheme(theme);
  document.documentElement.classList.toggle("dark", dark);
  if (persist && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {
      /* private mode / disabled storage */
    }
  }
}

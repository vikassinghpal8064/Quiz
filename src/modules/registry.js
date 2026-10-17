// The module registry: one entry per top-level area of the app.
//
// The app started as a single quiz product and is growing a second area
// (flash cards) that shares the same shell - auth, the account drawer, the
// theme, the fonts. Each entry describes a module so the shell can render
// navigation, work out which module the current URL belongs to, and link to
// the module home. Adding a module means adding a row here; AppShell never
// hard-codes a module name.
//
//   id       stable key; also the value stored in localStorage as the
//            "last used mode"
//   label    text shown in the mode switch and the nav items
//   icon     a single glyph, matching the app's text-icon style (no icon lib)
//   basePath route prefix that owns the module; "/" owns everything that no
//            other module's basePath claims
//   routes   the path patterns the module serves, most specific first. Kept
//            declarative so future steps can build sub-navigation without
//            touching the shell.
export const modules = [
  {
    id: "quiz",
    label: "Quiz",
    icon: "◆",
    basePath: "/",
    routes: [
      "/",
      "/subject/:subjectId",
      "/category/:categoryId",
      "/quiz/:categoryId",
      "/results/:attemptId",
      "/admin/upload",
      "/admin/questions",
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password/:token",
    ],
  },
  {
    id: "flashcards",
    label: "Flash Cards",
    icon: "▤",
    basePath: "/flash",
    // The module's own links, shown under its nav item when it is active.
    // Purely presentational navigation; every route already exists.
    links: [
      { label: "Home", to: "/flash" },
      { label: "Import", to: "/flash/import" },
      { label: "Stats", to: "/flash/stats" },
      { label: "Settings", to: "/flash/settings" },
    ],
    routes: [
      "/flash",
      "/flash/folder/:folderId",
      "/flash/category/:categoryId",
      "/flash/study/:sessionId",
      "/flash/import",
      "/flash/stats",
      "/flash/settings",
    ],
  },
];

// Which module owns a pathname? The longest basePath prefix wins, so
// "/flash/..." resolves to flashcards and everything else falls through to
// the "/" module (quiz). Non-root modules are checked first so the catch-all
// "/" can never swallow them.
export function moduleForPath(pathname) {
  const byLength = [...modules].sort((a, b) => b.basePath.length - a.basePath.length);
  for (const m of byLength) {
    if (m.basePath === "/") continue;
    if (pathname === m.basePath || pathname.startsWith(`${m.basePath}/`)) return m;
  }
  return modules.find((m) => m.basePath === "/") ?? null;
}

export default modules;

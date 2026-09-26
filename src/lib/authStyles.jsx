// Shared form styling for the auth pages, so /login, /register,
// /forgot-password and /reset-password stay visually identical.
export const fieldClass =
  "mt-1 block w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

export const labelClass = "block text-sm font-medium text-ink/70";

export const errorClass = "mt-1 text-xs text-red-600";

export const primaryButton =
  "inline-flex w-full items-center justify-center rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60";

export const authCard =
  "w-full max-w-md rounded-2xl border border-ink/10 bg-white p-8 shadow-card";

export function FieldError({ children }) {
  if (!children) return null;
  return <p className={errorClass}>{children}</p>;
}

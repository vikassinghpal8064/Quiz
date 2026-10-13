// Shared form styling for the auth pages, so /login, /register,
// /forgot-password and /reset-password stay visually identical.
export const fieldClass = "field mt-1 block w-full px-3 py-2.5 text-sm shadow-sm";

export const labelClass = "block text-sm font-medium text-ink/70";

export const errorClass = "mt-1 text-xs text-red-600";

export const primaryButton =
  "inline-flex w-full items-center justify-center rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60";

export const authCard =
  "w-full max-w-md rounded-2xl border border-ink/10 bg-white p-8 shadow-card";

export function FieldError({ children }) {
  if (!children) return null;
  return <p className={errorClass}>{children}</p>;
}

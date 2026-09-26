// Single source of truth for auth field rules, imported by both the
// serverless handlers (api/_lib/validate.js) and the React forms
// (src/pages/Register.jsx) so client-side checks can never drift from
// the server's. Deliberately dependency-free and environment-agnostic.

export const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
// 7-15 digits, optional leading +, no spaces or punctuation.
export const PHONE_RE = /^\+?[0-9]{7,15}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MIN_PASSWORD_LENGTH = 8;

export const RULES = {
  username: "3-32 characters, using letters, numbers, dot, dash or underscore",
  phone: "7-15 digits, optionally starting with +",
  email: "Enter a valid email address",
  password: `Must be at least ${MIN_PASSWORD_LENGTH} characters`,
};

// Strips the formatting people naturally type into a phone field
// before validating or storing it, so "+1 (555) 123-4567" and
// "+15551234567" are the same account.
export function normalizePhone(phone) {
  return String(phone ?? "").trim().replace(/[\s().-]/g, "");
}

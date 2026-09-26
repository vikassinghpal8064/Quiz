// Server-side validation for the auth endpoints. The field rules live
// in shared/authRules.js so the React forms enforce exactly the same
// constraints.
import {
  RULES,
  USERNAME_RE,
  PHONE_RE,
  EMAIL_RE,
  MIN_PASSWORD_LENGTH,
  normalizePhone,
} from "../../shared/authRules.js";

export function validateRegistration({ username, password, phone_number, email }) {
  const errors = {};

  const name = String(username ?? "").trim();
  if (!name) {
    errors.username = "Username is required";
  } else if (!USERNAME_RE.test(name)) {
    errors.username = `Username must be ${RULES.username}`;
  }

  const pw = String(password ?? "");
  if (!pw) {
    errors.password = "Password is required";
  } else if (pw.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be ${MIN_PASSWORD_LENGTH} characters or more`;
  } else if (pw.length > 200) {
    errors.password = "Password is too long";
  }

  const phone = normalizePhone(phone_number);
  if (!phone) {
    errors.phone_number = "Phone number is required";
  } else if (!PHONE_RE.test(phone)) {
    errors.phone_number = `Phone number must be ${RULES.phone}`;
  }

  const mail = String(email ?? "").trim().toLowerCase();
  if (!mail) {
    errors.email = "Email is required";
  } else if (!EMAIL_RE.test(mail) || mail.length > 254) {
    errors.email = RULES.email;
  }

  return { errors, value: { username: name, phone, email: mail } };
}

export function validatePassword(password) {
  const pw = String(password ?? "");
  if (!pw) return { error: "Password is required" };
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be ${MIN_PASSWORD_LENGTH} characters or more` };
  }
  if (pw.length > 200) return { error: "Password is too long" };
  return { error: null };
}

export { normalizePhone, EMAIL_RE };

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/authContext";
import { fieldClass, labelClass, primaryButton, authCard, FieldError } from "../lib/authStyles";
import { USERNAME_RE, EMAIL_RE, PHONE_RE, MIN_PASSWORD_LENGTH } from "../../shared/authRules";

// Same rules the server enforces, so obvious mistakes are caught
// before a round trip. The server re-validates regardless.
function validate({ username, password, confirm, phone_number, email }) {
  const errors = {};

  if (!username.trim()) errors.username = "Username is required";
  else if (!USERNAME_RE.test(username.trim()))
    errors.username =
      "3-32 characters, using letters, numbers, dot, dash or underscore";

  if (!password) errors.password = "Password is required";
  else if (password.length < MIN_PASSWORD_LENGTH)
    errors.password = `Must be at least ${MIN_PASSWORD_LENGTH} characters`;

  if (password !== confirm) errors.confirm = "Passwords do not match";

  const phone = phone_number.trim().replace(/[\s().-]/g, "");
  if (!phone) errors.phone_number = "Phone number is required";
  else if (!PHONE_RE.test(phone))
    errors.phone_number = "7-15 digits, optionally starting with +";

  if (!email.trim()) errors.email = "Email is required";
  else if (!EMAIL_RE.test(email.trim())) errors.email = "Enter a valid email address";

  return errors;
}

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    username: "",
    password: "",
    confirm: "",
    phone_number: "",
    email: "",
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function update(key) {
    return (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      await register({
        username: form.username.trim(),
        password: form.password,
        phone_number: form.phone_number.trim(),
        email: form.email.trim(),
      });
      navigate("/login", { replace: true });
    } catch (err) {
      // Surface server-side conflicts (username / phone already taken)
      // on the matching field.
      if (err.fields) setErrors(err.fields);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className={authCard}>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Create your account
        </h1>
        <p className="mt-1 text-sm text-ink/55">
          Track your progress and practise the questions you get wrong.
        </p>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="username" className={labelClass}>
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={form.username}
              onChange={update("username")}
              className={fieldClass}
            />
            <FieldError>{errors.username}</FieldError>
          </div>

          <div>
            <label htmlFor="email" className={labelClass}>
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={update("email")}
              className={fieldClass}
            />
            <FieldError>{errors.email}</FieldError>
          </div>

          <div>
            <label htmlFor="phone_number" className={labelClass}>
              Phone number
            </label>
            <input
              id="phone_number"
              type="tel"
              autoComplete="tel"
              placeholder="+15551234567"
              value={form.phone_number}
              onChange={update("phone_number")}
              className={fieldClass}
            />
            <FieldError>{errors.phone_number}</FieldError>
          </div>

          <div>
            <label htmlFor="password" className={labelClass}>
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={update("password")}
              className={fieldClass}
            />
            <FieldError>{errors.password}</FieldError>
          </div>

          <div>
            <label htmlFor="confirm" className={labelClass}>
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={update("confirm")}
              className={fieldClass}
            />
            <FieldError>{errors.confirm}</FieldError>
          </div>

          <button type="submit" disabled={busy} className={primaryButton}>
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-sm text-ink/55">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-emerald-700 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

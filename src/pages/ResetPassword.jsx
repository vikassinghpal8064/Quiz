import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fieldClass, labelClass, primaryButton, authCard, FieldError } from "../lib/authStyles";
import { MIN_PASSWORD_LENGTH } from "../../shared/authRules";

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const found = {};
    if (!password) found.password = "Password is required";
    else if (password.length < MIN_PASSWORD_LENGTH)
      found.password = `Must be at least ${MIN_PASSWORD_LENGTH} characters`;
    if (password !== confirm) found.confirm = "Passwords do not match";

    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/auth/reset-password/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ new_password: password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Could not reset your password");
      }

      setDone(true);
      setTimeout(() => navigate("/login", { replace: true }), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className={authCard}>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Choose a new password
        </h1>

        {done ? (
          <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            Password updated. Taking you to sign in…
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-ink/55">
              This link can only be used once.
            </p>

            {error && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
              <div>
                <label htmlFor="new_password" className={labelClass}>
                  New password
                </label>
                <input
                  id="new_password"
                  type="password"
                  autoComplete="new-password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={fieldClass}
                />
                <FieldError>{errors.password}</FieldError>
              </div>

              <div>
                <label htmlFor="confirm" className={labelClass}>
                  Confirm new password
                </label>
                <input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={fieldClass}
                />
                <FieldError>{errors.confirm}</FieldError>
              </div>

              <button type="submit" disabled={busy} className={primaryButton}>
                {busy ? "Updating…" : "Update password"}
              </button>
            </form>
          </>
        )}

        <p className="mt-6 text-sm text-ink/55">
          <Link to="/login" className="font-medium text-emerald-700 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

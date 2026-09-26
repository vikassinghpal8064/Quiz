import { useState } from "react";
import { Link } from "react-router-dom";
import { fieldClass, labelClass, primaryButton, authCard, FieldError } from "../lib/authStyles";
import { EMAIL_RE } from "../../shared/authRules";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter a valid email address");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Could not process that request");
      }

      setSent(true);
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
          Reset your password
        </h1>

        {sent ? (
          <div className="mt-4">
            <p className="text-sm leading-relaxed text-ink/70">
              If an account exists for that email address, a password reset link
              has been sent. The link expires in 45 minutes and can only be used
              once.
            </p>
            <p className="mt-4 text-sm text-ink/55">
              <Link
                to="/login"
                className="font-medium text-emerald-700 hover:underline"
              >
                Back to sign in
              </Link>
            </p>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-ink/55">
              Enter the email address on your account and we will send you a link
              to choose a new password.
            </p>

            {error && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
              <div>
                <label htmlFor="email" className={labelClass}>
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={fieldClass}
                />
                <FieldError>{error}</FieldError>
              </div>

              <button type="submit" disabled={busy} className={primaryButton}>
                {busy ? "Sending…" : "Send reset link"}
              </button>
            </form>

            <p className="mt-6 text-sm text-ink/55">
              <Link to="/login" className="font-medium text-emerald-700 hover:underline">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

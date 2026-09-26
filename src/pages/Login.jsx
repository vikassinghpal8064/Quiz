import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/authContext";
import { fieldClass, labelClass, primaryButton, authCard } from "../lib/authStyles";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const from = location.state?.from || "/";

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError("Enter your username and password");
      return;
    }

    setBusy(true);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
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
          Sign in
        </h1>
        <p className="mt-1 text-sm text-ink/55">
          Welcome back. Enter your details to continue.
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
              name="username"
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="password" className={labelClass}>
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={fieldClass}
            />
          </div>

          <button type="submit" disabled={busy} className={primaryButton}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-6 space-y-2 text-sm text-ink/55">
          <p>
            <Link
              to="/forgot-password"
              className="font-medium text-emerald-700 hover:underline"
            >
              Forgot your password?
            </Link>
          </p>
          <p>
            No account yet?{" "}
            <Link
              to="/register"
              className="font-medium text-emerald-700 hover:underline"
            >
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

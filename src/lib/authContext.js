import { createContext, useContext } from "react";

// Kept in a plain .js module (no JSX) so the react-refresh lint rule
// stays happy: this file exports no components, only the context and
// its hook.
export const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}

import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/authContext";
import LoadingSkeleton from "./LoadingSkeleton";

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  // Don't bounce to /login before /api/auth/me has answered, or a
  // refresh on a logged-in page would flash the login screen.
  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <LoadingSkeleton />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return children;
}

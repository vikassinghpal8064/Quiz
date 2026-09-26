import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/authContext";
import LoadingSkeleton from "./LoadingSkeleton";

// Non-admins are redirected away entirely, so admin pages are never
// rendered for them. The API enforces the same rule server-side
// (requireAdmin -> 403); this wrapper just avoids showing the UI.
export default function AdminRoute({ children }) {
  const { isAuthenticated, isAdmin, loading } = useAuth();
  const location = useLocation();

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

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return children;
}

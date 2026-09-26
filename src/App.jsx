import { Navigate, Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import PageTransition from "./components/PageTransition";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminRoute from "./components/AdminRoute";
import AccountSidebar from "./components/AccountSidebar";
import { useAuth } from "./lib/authContext";
import Dashboard from "./pages/Dashboard";
import CategoryList from "./pages/CategoryList";
import QuizIntro from "./pages/QuizIntro";
import QuizTaking from "./pages/QuizTaking";
import Results from "./pages/Results";
import AdminUpload from "./pages/AdminUpload";
import ManageQuestions from "./pages/ManageQuestions";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";

export default function App() {
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-cream font-sans text-ink">
      {isAuthenticated && <AccountSidebar />}

      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          {/* Public: reachable without a session. */}
          <Route
            path="/login"
            element={
              <PageTransition>
                <Login />
              </PageTransition>
            }
          />
          <Route
            path="/register"
            element={
              <PageTransition>
                <Register />
              </PageTransition>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <PageTransition>
                <ForgotPassword />
              </PageTransition>
            }
          />
          <Route
            path="/reset-password/:token"
            element={
              <PageTransition>
                <ResetPassword />
              </PageTransition>
            }
          />

          {/* Signed-in: any role. */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <PageTransition>
                  <Dashboard />
                </PageTransition>
              </ProtectedRoute>
            }
          />
          <Route
            path="/subject/:subjectId"
            element={
              <ProtectedRoute>
                <PageTransition>
                  <CategoryList />
                </PageTransition>
              </ProtectedRoute>
            }
          />
          <Route
            path="/category/:categoryId"
            element={
              <ProtectedRoute>
                <PageTransition>
                  <QuizIntro />
                </PageTransition>
              </ProtectedRoute>
            }
          />
          <Route
            path="/quiz/:categoryId"
            element={
              <ProtectedRoute>
                <PageTransition>
                  <QuizTaking />
                </PageTransition>
              </ProtectedRoute>
            }
          />
          <Route
            path="/results/:attemptId"
            element={
              <ProtectedRoute>
                <PageTransition>
                  <Results />
                </PageTransition>
              </ProtectedRoute>
            }
          />

          {/* Admin only. */}
          <Route
            path="/admin/upload"
            element={
              <AdminRoute>
                <PageTransition>
                  <AdminUpload />
                </PageTransition>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/questions"
            element={
              <AdminRoute>
                <PageTransition>
                  <ManageQuestions />
                </PageTransition>
              </AdminRoute>
            }
          />

          {/* Unknown path: go home. ProtectedRoute then bounces
              anonymous visitors to /login. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
    </div>
  );
}

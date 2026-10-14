import { lazy, Suspense } from "react";
import { Navigate, Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import PageTransition from "./components/PageTransition";
import LoadingSkeleton from "./components/LoadingSkeleton";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminRoute from "./components/AdminRoute";
import AccountSidebar from "./components/AccountSidebar";
import { useAuth } from "./lib/authContext";

// Each page is its own chunk, fetched the first time its route is visited.
// That keeps the initial download to the app shell instead of every page.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const CategoryList = lazy(() => import("./pages/CategoryList"));
const QuizIntro = lazy(() => import("./pages/QuizIntro"));
const QuizTaking = lazy(() => import("./pages/QuizTaking"));
const Results = lazy(() => import("./pages/Results"));
const AdminUpload = lazy(() => import("./pages/AdminUpload"));
const ManageQuestions = lazy(() => import("./pages/ManageQuestions"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));

// One Suspense boundary per page, kept inside PageTransition so the layout and
// the exit animation around it are unaffected while a chunk loads.
function PageChunk({ children }) {
  return <Suspense fallback={<LoadingSkeleton />}>{children}</Suspense>;
}

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
                <PageChunk>
                  <Login />
                </PageChunk>
              </PageTransition>
            }
          />
          <Route
            path="/register"
            element={
              <PageTransition>
                <PageChunk>
                  <Register />
                </PageChunk>
              </PageTransition>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <PageTransition>
                <PageChunk>
                  <ForgotPassword />
                </PageChunk>
              </PageTransition>
            }
          />
          <Route
            path="/reset-password/:token"
            element={
              <PageTransition>
                <PageChunk>
                  <ResetPassword />
                </PageChunk>
              </PageTransition>
            }
          />

          {/* Signed-in: any role. */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <PageTransition>
                  <PageChunk>
                    <Dashboard />
                  </PageChunk>
                </PageTransition>
              </ProtectedRoute>
            }
          />
          <Route
            path="/subject/:subjectId"
            element={
              <ProtectedRoute>
                <PageTransition>
                  <PageChunk>
                    <CategoryList />
                  </PageChunk>
                </PageTransition>
              </ProtectedRoute>
            }
          />
          <Route
            path="/category/:categoryId"
            element={
              <ProtectedRoute>
                <PageTransition>
                  <PageChunk>
                    <QuizIntro />
                  </PageChunk>
                </PageTransition>
              </ProtectedRoute>
            }
          />
          <Route
            path="/quiz/:categoryId"
            element={
              <ProtectedRoute>
                <PageTransition>
                  <PageChunk>
                    <QuizTaking />
                  </PageChunk>
                </PageTransition>
              </ProtectedRoute>
            }
          />
          <Route
            path="/results/:attemptId"
            element={
              <ProtectedRoute>
                <PageTransition>
                  <PageChunk>
                    <Results />
                  </PageChunk>
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
                  <PageChunk>
                    <AdminUpload />
                  </PageChunk>
                </PageTransition>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/questions"
            element={
              <AdminRoute>
                <PageTransition>
                  <PageChunk>
                    <ManageQuestions />
                  </PageChunk>
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

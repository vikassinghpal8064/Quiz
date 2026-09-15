import { Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import PageTransition from "./components/PageTransition";
import Dashboard from "./pages/Dashboard";
import CategoryList from "./pages/CategoryList";
import QuizIntro from "./pages/QuizIntro";
import QuizTaking from "./pages/QuizTaking";
import Results from "./pages/Results";
import AdminUpload from "./pages/AdminUpload";

export default function App() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-cream font-sans text-ink">
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route
            path="/"
            element={
              <PageTransition>
                <Dashboard />
              </PageTransition>
            }
          />
          <Route
            path="/subject/:subjectId"
            element={
              <PageTransition>
                <CategoryList />
              </PageTransition>
            }
          />
          <Route
            path="/category/:categoryId"
            element={
              <PageTransition>
                <QuizIntro />
              </PageTransition>
            }
          />
          <Route
            path="/quiz/:categoryId"
            element={
              <PageTransition>
                <QuizTaking />
              </PageTransition>
            }
          />
          <Route
            path="/results/:attemptId"
            element={
              <PageTransition>
                <Results />
              </PageTransition>
            }
          />
          <Route
            path="/admin/upload"
            element={
              <PageTransition>
                <AdminUpload />
              </PageTransition>
            }
          />
        </Routes>
      </AnimatePresence>
    </div>
  );
}
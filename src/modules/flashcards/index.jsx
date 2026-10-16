import { Navigate, Route, Routes } from "react-router-dom";
import FlashHome from "./pages/FlashHome";
import FolderPage from "./pages/FolderPage";
import CategoryPage from "./pages/CategoryPage";
import StudyPage from "./pages/StudyPage";
import ImportPage from "./pages/ImportPage";
import StatsPage from "./pages/StatsPage";
import SettingsPage from "./pages/SettingsPage";

// The whole flash-card module is one lazy chunk (React.lazy in App.jsx imports
// this file). Its routes are declared relative to the parent "/flash/*" route
// via a descendant <Routes>, so adding a flash page means editing only this
// module - App.jsx owns a single entry for "/flash/*".
export default function FlashcardsModule() {
  return (
    <Routes>
      <Route index element={<FlashHome />} />
      <Route path="folder/:folderId" element={<FolderPage />} />
      <Route path="category/:categoryId" element={<CategoryPage />} />
      <Route path="study/:sessionId" element={<StudyPage />} />
      <Route path="import" element={<ImportPage />} />
      <Route path="stats" element={<StatsPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/flash" replace />} />
    </Routes>
  );
}

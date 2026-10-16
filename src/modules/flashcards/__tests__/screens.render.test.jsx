import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import FlashHome from "../pages/FlashHome";
import FolderPage from "../pages/FolderPage";
import CategoryPage from "../pages/CategoryPage";
import StudyPage from "../pages/StudyPage";
import ImportPage from "../pages/ImportPage";

// Server-render smoke test: it exercises each screen's first render (imports,
// hooks, markup) without a DOM or a database. Effects do not run under
// renderToString, so the screens stay in their loading state - which is exactly
// what we want to assert renders cleanly.
function render(path, element) {
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/flash" element={element} />
        <Route path="/flash/folder/:folderId" element={element} />
        <Route path="/flash/category/:categoryId" element={element} />
        <Route path="/flash/study/:sessionId" element={element} />
        <Route path="/flash/import" element={element} />
      </Routes>
    </MemoryRouter>
  );
}

describe("flash screens", () => {
  it("home renders without throwing", () => {
    const html = render("/flash", <FlashHome />);
    expect(html).toContain("Flash Cards");
    expect(html).toContain("New Folder");
  });

  it("folder page renders without throwing", () => {
    const html = render("/flash/folder/1", <FolderPage />);
    expect(html).toContain("Flash Cards");
  });

  it("category page renders without throwing", () => {
    const html = render("/flash/category/1", <CategoryPage />);
    expect(html).toContain("Flash Cards");
  });

  it("study page renders its loading state without throwing", () => {
    const html = render("/flash/study/1", <StudyPage />);
    // The session is fetched in an effect (which does not run under
    // renderToString), so the first render is the loading skeleton.
    expect(html).toContain("animate-pulse");
  });

  it("import page renders without throwing", () => {
    const html = render("/flash/import", <ImportPage />);
    expect(html).toContain("Import Cards");
    expect(html).toContain("Source");
  });
});

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AppShell from "./components/layout/AppShell";
import DashboardPage from "./pages/DashboardPage";
import CategoryPage from "./pages/CategoryPage";
import BrandDetailPage from "./pages/BrandDetailPage";
import BattlecardsPage from "./pages/BattlecardsPage";
import AgentPage from "./pages/AgentPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000 } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/category/:categorySlug" element={<CategoryPage />} />
            <Route path="/brand/:brandName" element={<BrandDetailPage />} />
            <Route path="/battlecards" element={<BattlecardsPage />} />
            <Route path="/agent" element={<AgentPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AppShell from "./components/layout/AppShell";
import DashboardPage from "./pages/DashboardPage";
import CategoryPage from "./pages/CategoryPage";
import BrandDetailPage from "./pages/BrandDetailPage";
import BattlecardDetailPage from "./pages/BattlecardDetailPage";
import BattlecardsPage from "./pages/BattlecardsPage";
import AgentPage from "./pages/AgentPage";
import ReplenishmentPage from "./pages/ReplenishmentPage";
import CustomerDemandPage from "./pages/CustomerDemandPage";
import DemandDetailPage from "./pages/DemandDetailPage";
import DcReplenishmentPage from "./pages/DcReplenishmentPage";
import StockAlertsPage from "./pages/StockAlertsPage";
import SupplierDifotPage from "./pages/SupplierDifotPage";
import SupplierDifotBrandPage from "./pages/SupplierDifotBrandPage";
import ReorderQueuePage from "./pages/ReorderQueuePage";
import ReplenishmentBrandPage from "./pages/ReplenishmentBrandPage";
import SkuDetailPage from "./pages/SkuDetailPage";
import StoreDemandProfilePage from "./pages/StoreDemandProfilePage";

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
            <Route path="/brand/:brandName/battlecard" element={<BattlecardDetailPage />} />
            <Route path="/battlecards" element={<BattlecardsPage />} />
            <Route path="/agent" element={<AgentPage />} />
            <Route path="/replenishment" element={<ReplenishmentPage />} />
            <Route path="/replenishment/demand" element={<CustomerDemandPage />} />
            <Route path="/replenishment/demand/:brand/:sku" element={<DemandDetailPage />} />
            <Route path="/replenishment/demand/store/:storeName" element={<StoreDemandProfilePage />} />
            <Route path="/replenishment/dc" element={<DcReplenishmentPage />} />
            <Route path="/replenishment/alerts" element={<StockAlertsPage />} />
            <Route path="/replenishment/difot" element={<SupplierDifotPage />} />
            <Route path="/replenishment/difot/:brand" element={<SupplierDifotBrandPage />} />
            <Route path="/replenishment/reorder" element={<ReorderQueuePage />} />
            <Route path="/replenishment/brand/:brandName" element={<ReplenishmentBrandPage />} />
            <Route path="/replenishment/brand/:brandName/sku/:skuClass" element={<SkuDetailPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface BrandProfile {
  brand: string;
  category: string;
  currentStock: number;
  dailyDemand: number;
  weeklyDemand: number;
  reorderPoint: number;
  leadTimeDays: number;
  avgDeliveryQty: number;
  nextDelivery: string;
  nextDeliveryQty: number;
  stockoutCostPerDay: number;
  supplierName: string;
  targetWoc: number;
  woc: number;
}

export interface StockAlert {
  id: string;
  brand: string;
  category: string;
  type: "critical" | "warning" | "info";
  title: string;
  description: string;
  timestamp: string;
  woc: number;
  action: string;
}

export interface WeeklyForecast {
  week: string;
  weekDate: string;
  isForecast: boolean;
  openingStock: number;
  demand: number;
  delivery: number;
  closingStock: number;
  shelfPct: number;
  reorderPoint: number;
}

export interface BrandSupply {
  brand: string;
  category: string;
  currentStock: number;
  dailyDemand: number;
  weeklyDemand: number;
  reorderPoint: number;
  safetyStock: number;
  leadTimeDays: number;
  avgDeliveryQty: number;
  nextDelivery: string;
  nextDeliveryQty: number;
  stockoutCostPerDay: number;
  supplierName: string;
  orderFrequencyDays: number;
  minOrderQty: number;
  targetWoc: number;
  weeklyForecast: WeeklyForecast[];
}

const CACHE_FOREVER = { staleTime: Infinity, gcTime: Infinity };

async function fetchProfiles(): Promise<BrandProfile[]> {
  const res = await fetch("/api/supply/profiles");
  return res.json();
}

async function fetchAlerts(): Promise<StockAlert[]> {
  const res = await fetch("/api/supply/alerts");
  return res.json();
}

async function fetchBrandSupply(brand: string): Promise<BrandSupply> {
  const res = await fetch(`/api/supply/brand/${encodeURIComponent(brand)}`);
  return res.json();
}

export function useSupplyProfiles() {
  return useQuery({ queryKey: ["supply", "profiles"], queryFn: fetchProfiles, ...CACHE_FOREVER });
}

export function useSupplyAlerts() {
  return useQuery({ queryKey: ["supply", "alerts"], queryFn: fetchAlerts, ...CACHE_FOREVER });
}

export function useBrandSupply(brand: string) {
  return useQuery({ queryKey: ["supply", "brand", brand], queryFn: () => fetchBrandSupply(brand), ...CACHE_FOREVER, enabled: !!brand });
}

export function usePrefetchSupplyData() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.prefetchQuery({ queryKey: ["supply", "profiles"], queryFn: fetchProfiles, ...CACHE_FOREVER });
    queryClient.prefetchQuery({ queryKey: ["supply", "alerts"], queryFn: fetchAlerts, ...CACHE_FOREVER });
  };
}

export function useRefreshSupplyData() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["supply"] });
  };
}

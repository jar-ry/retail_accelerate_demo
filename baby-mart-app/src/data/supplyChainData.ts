import { brandData } from "./brandConfig";

export interface WeeklyForecast {
  week: string;
  weekNum: number;
  openingStock: number;
  demand: number;
  delivery: number;
  closingStock: number;
  shelfPct: number;
  isForecast: boolean;
}

export interface BrandSupplyData {
  brand: string;
  category: string;
  currentStock: number;
  dailyDemand: number;
  reorderPoint: number;
  leadTimeDays: number;
  avgDeliveryQty: number;
  weeklyForecast: WeeklyForecast[];
  nextDelivery: string;
  nextDeliveryQty: number;
  stockoutCostPerDay: number;
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

export interface ReorderItem {
  brand: string;
  category: string;
  currentWoc: number;
  dailyRunRate: number;
  qtyToOrder: number;
  leadTimeDays: number;
  priority: "urgent" | "high" | "medium";
  estCost: number;
}

const leadTimes: Record<string, number> = {
  "Nappies & Wipes": 10,
  "Prams & Strollers": 21,
  "Car Seats": 18,
  "Clothing": 7,
  "Feeding": 12,
};

function parseDailyDemand(ros: string): number {
  const perWeek = parseFloat(ros.replace("/wk", ""));
  return perWeek / 7;
}

function generateWeeklyForecast(brand: string): WeeklyForecast[] {
  const data = brandData[brand];
  if (!data) return [];

  const dailyDemand = parseDailyDemand(data.ros);
  const weeklyDemand = Math.round(dailyDemand * 7);
  const currentStock = Math.round(parseFloat(data.woc) * weeklyDemand);
  const reorderPoint = 4 * weeklyDemand;
  const deliveryQty = Math.round(weeklyDemand * 6);

  const weeks: WeeklyForecast[] = [];
  let stock = Math.round(currentStock * 1.8);

  const deliveryWeeks = [3, 7, 11];

  for (let i = 0; i < 12; i++) {
    const isForecast = i >= 8;
    const weekLabel = isForecast ? `F+${i - 7}` : `W${i - 7}`;
    const demandVariation = 1 + (Math.sin(i * 0.8) * 0.15);
    const demand = Math.round(weeklyDemand * demandVariation);
    const delivery = deliveryWeeks.includes(i) ? deliveryQty : 0;
    const opening = stock;
    const closing = Math.max(0, opening + delivery - demand);
    const shelfPct = closing > reorderPoint * 0.3 ? 98 : closing > 0 ? Math.round(70 + (closing / (reorderPoint * 0.3)) * 28) : Math.round(45 + Math.random() * 15);

    weeks.push({
      week: weekLabel,
      weekNum: i,
      openingStock: opening,
      demand,
      delivery,
      closingStock: closing,
      shelfPct: Math.min(99, shelfPct),
      isForecast,
    });

    stock = closing;
  }

  return weeks;
}

export function getBrandSupplyData(brand: string): BrandSupplyData | null {
  const data = brandData[brand];
  if (!data) return null;

  const dailyDemand = parseDailyDemand(data.ros);
  const weeklyDemand = dailyDemand * 7;
  const currentStock = Math.round(parseFloat(data.woc) * weeklyDemand);
  const reorderPoint = Math.round(4 * weeklyDemand);
  const leadTime = leadTimes[data.category] || 14;
  const deliveryQty = Math.round(weeklyDemand * 6);

  const revenue = data.revenue.replace(/[$KM,]/g, "");
  const revMultiplier = data.revenue.includes("M") ? 1000000 : data.revenue.includes("K") ? 1000 : 1;
  const totalRev = parseFloat(revenue) * revMultiplier;
  const units = parseInt(data.units.replace(/,/g, ""));
  const pricePerUnit = units > 0 ? totalRev / units : 20;
  const stockoutCostPerDay = Math.round(dailyDemand * pricePerUnit * 0.6);

  return {
    brand,
    category: data.category,
    currentStock,
    dailyDemand: Math.round(dailyDemand * 10) / 10,
    reorderPoint,
    leadTimeDays: leadTime,
    avgDeliveryQty: deliveryQty,
    weeklyForecast: generateWeeklyForecast(brand),
    nextDelivery: "2 Jun 2026",
    nextDeliveryQty: deliveryQty,
    stockoutCostPerDay,
  };
}

export function getAllAlerts(): StockAlert[] {
  const alerts: StockAlert[] = [];
  const now = new Date();

  Object.values(brandData).forEach((b) => {
    const woc = parseFloat(b.woc);
    const difot = parseFloat(b.difot);

    if (woc < 3) {
      alerts.push({
        id: `${b.name}-crit`,
        brand: b.name,
        category: b.category,
        type: "critical",
        title: "Immediate Reorder Required",
        description: `Stock at ${b.woc} weeks of cover — below minimum threshold. Risk of stockout within ${Math.round(woc * 7)} days.`,
        timestamp: new Date(now.getTime() - Math.random() * 3600000).toISOString(),
        woc,
        action: "Place emergency order",
      });
    } else if (woc < 4) {
      alerts.push({
        id: `${b.name}-low`,
        brand: b.name,
        category: b.category,
        type: "critical",
        title: "Stock Below Reorder Point",
        description: `${b.woc} WOC — approaching stockout. Lead time is ${leadTimes[b.category] || 14} days.`,
        timestamp: new Date(now.getTime() - Math.random() * 7200000).toISOString(),
        woc,
        action: "Initiate standard reorder",
      });
    } else if (woc < 5) {
      alerts.push({
        id: `${b.name}-warn`,
        brand: b.name,
        category: b.category,
        type: "warning",
        title: "Stock Declining",
        description: `${b.woc} WOC — monitor closely. ${Math.round((woc - 4) * 7)} days buffer above reorder point.`,
        timestamp: new Date(now.getTime() - Math.random() * 14400000).toISOString(),
        woc,
        action: "Monitor — prepare reorder",
      });
    }

    if (difot < 90) {
      alerts.push({
        id: `${b.name}-difot-crit`,
        brand: b.name,
        category: b.category,
        type: "critical",
        title: "Supplier Performance Critical",
        description: `DIFOT at ${b.difot} — significantly below 96% target. Increase safety stock.`,
        timestamp: new Date(now.getTime() - Math.random() * 28800000).toISOString(),
        woc,
        action: "Escalate to supplier + increase safety stock",
      });
    } else if (difot < 94) {
      alerts.push({
        id: `${b.name}-difot-warn`,
        brand: b.name,
        category: b.category,
        type: "warning",
        title: "Supplier DIFOT Below Target",
        description: `DIFOT at ${b.difot} — below 96% target. ${Math.round(96 - difot)}pp gap to close.`,
        timestamp: new Date(now.getTime() - Math.random() * 43200000).toISOString(),
        woc,
        action: "Review with supplier",
      });
    }

    if (woc > 12) {
      alerts.push({
        id: `${b.name}-over`,
        brand: b.name,
        category: b.category,
        type: "info",
        title: "Overstock — Capital Tied Up",
        description: `${b.woc} WOC — well above optimal range. Consider markdown or promotion.`,
        timestamp: new Date(now.getTime() - Math.random() * 86400000).toISOString(),
        woc,
        action: "Review markdown/promo options",
      });
    }
  });

  return alerts.sort((a, b) => {
    const priority = { critical: 0, warning: 1, info: 2 };
    return priority[a.type] - priority[b.type];
  });
}

export function getReorderQueue(): ReorderItem[] {
  return Object.values(brandData)
    .filter((b) => parseFloat(b.woc) < 6)
    .map((b) => {
      const woc = parseFloat(b.woc);
      const dailyDemand = parseDailyDemand(b.ros);
      const weeklyDemand = dailyDemand * 7;
      const targetWoc = 8;
      const currentStock = Math.round(woc * weeklyDemand);
      const targetStock = Math.round(targetWoc * weeklyDemand);
      const qtyToOrder = Math.max(0, targetStock - currentStock);
      const leadTime = leadTimes[b.category] || 14;

      const revenue = b.revenue.replace(/[$KM,]/g, "");
      const revMultiplier = b.revenue.includes("M") ? 1000000 : b.revenue.includes("K") ? 1000 : 1;
      const totalRev = parseFloat(revenue) * revMultiplier;
      const units = parseInt(b.units.replace(/,/g, ""));
      const costPerUnit = units > 0 ? (totalRev / units) * 0.6 : 15;

      let priority: "urgent" | "high" | "medium" = "medium";
      if (woc < 3) priority = "urgent";
      else if (woc < 4) priority = "high";

      return {
        brand: b.name,
        category: b.category,
        currentWoc: woc,
        dailyRunRate: Math.round(dailyDemand * 10) / 10,
        qtyToOrder: Math.round(qtyToOrder),
        leadTimeDays: leadTime,
        priority,
        estCost: Math.round(qtyToOrder * costPerUnit),
      };
    })
    .sort((a, b) => {
      const p = { urgent: 0, high: 1, medium: 2 };
      return p[a.priority] - p[b.priority] || a.currentWoc - b.currentWoc;
    });
}

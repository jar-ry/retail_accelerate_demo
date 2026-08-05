"use client";

import { useState, useEffect } from "react";
import { Loader2, Package, Clock, AlertTriangle, Truck } from "lucide-react";

interface PurchaseOrder {
  po: string; orderDate: string; expectedDate: string; supplier: string;
  brand: string; sku: string; dc: string; orderedUnits: number;
  carrier: string; pallets: number; status: string; daysUntilDue: number;
}

function statusBadge(status: string) {
  switch (status) {
    case "ON_ORDER": return "bg-slate-100 text-slate-700";
    case "IN_TRANSIT": return "bg-blue-100 text-blue-700";
    case "OVERDUE": return "bg-red-100 text-red-700";
    default: return "bg-slate-100 text-slate-600";
  }
}

function statusIcon(status: string) {
  switch (status) {
    case "ON_ORDER": return <Clock className="w-3 h-3" />;
    case "IN_TRANSIT": return <Truck className="w-3 h-3" />;
    case "OVERDUE": return <AlertTriangle className="w-3 h-3" />;
    default: return null;
  }
}

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");

  useEffect(() => {
    fetch("/api/supply/purchase-orders")
      .then(r => r.json())
      .then(setOrders)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /></div>;

  const suppliers = ["all", ...new Set(orders.map(o => o.supplier))];
  const filtered = orders
    .filter(o => statusFilter === "all" || o.status === statusFilter)
    .filter(o => supplierFilter === "all" || o.supplier === supplierFilter);

  const onOrder = orders.filter(o => o.status === "ON_ORDER").length;
  const inTransit = orders.filter(o => o.status === "IN_TRANSIT").length;
  const overdue = orders.filter(o => o.status === "OVERDUE").length;
  const totalPallets = orders.reduce((s, o) => s + o.pallets, 0);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Purchase Orders</h1>
        <p className="text-sm text-slate-500 mt-1">Active orders with suppliers — on order, in transit, and overdue</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border p-5">
          <div className="text-xs text-slate-500 font-medium">On Order</div>
          <div className="text-2xl font-bold mt-1 text-slate-900">{onOrder}</div>
          <div className="text-xs text-slate-400 mt-1">Awaiting dispatch</div>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-5">
          <div className="text-xs text-blue-600 font-medium flex items-center gap-1"><Truck className="w-3 h-3" /> In Transit</div>
          <div className="text-2xl font-bold mt-1 text-blue-700">{inTransit}</div>
          <div className="text-xs text-blue-500 mt-1">En route to DC</div>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-200 p-5">
          <div className="text-xs text-red-600 font-medium flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Overdue</div>
          <div className="text-2xl font-bold mt-1 text-red-700">{overdue}</div>
          <div className="text-xs text-red-500 mt-1">Past expected date</div>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <div className="text-xs text-slate-500 font-medium">Total Pallets</div>
          <div className="text-2xl font-bold mt-1 text-slate-900">{totalPallets}</div>
          <div className="text-xs text-slate-400 mt-1">Expected inbound</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1">
          {["all", "ON_ORDER", "IN_TRANSIT", "OVERDUE"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${statusFilter === s ? "bg-white shadow text-slate-900" : "text-slate-500"}`}>
              {s === "all" ? "All" : s.replace("_", " ")}
            </button>
          ))}
        </div>
        <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} className="text-xs border rounded-md px-2 py-1.5">
          {suppliers.map(s => <option key={s} value={s}>{s === "all" ? "All Suppliers" : s}</option>)}
        </select>
        <span className="text-xs text-slate-400 ml-auto">{filtered.length} of {orders.length} orders</span>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-xl border p-5">
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white"><tr className="border-b text-left text-slate-500">
              <th className="pb-2 font-medium">PO #</th>
              <th className="pb-2 font-medium">Supplier</th>
              <th className="pb-2 font-medium">Brand / SKU</th>
              <th className="pb-2 font-medium">DC</th>
              <th className="pb-2 font-medium">Units</th>
              <th className="pb-2 font-medium">Pallets</th>
              <th className="pb-2 font-medium">Carrier</th>
              <th className="pb-2 font-medium">Order Date</th>
              <th className="pb-2 font-medium">Expected</th>
              <th className="pb-2 font-medium">Status</th>
            </tr></thead>
            <tbody>
              {filtered.map(o => (
                <tr key={o.po} className={`border-b border-slate-50 hover:bg-slate-50 ${o.status === "OVERDUE" ? "bg-red-50/30" : ""}`}>
                  <td className="py-2 font-mono text-xs text-slate-600">{o.po}</td>
                  <td className="py-2 text-xs font-medium text-slate-800">{o.supplier}</td>
                  <td className="py-2">
                    <div className="text-xs font-medium text-slate-800">{o.brand}</div>
                    <div className="text-[10px] text-slate-500">{o.sku}</div>
                  </td>
                  <td className="py-2 text-xs text-slate-600">{o.dc}</td>
                  <td className="py-2 text-xs text-slate-800">{o.orderedUnits.toLocaleString()}</td>
                  <td className="py-2 text-xs text-slate-600">{o.pallets}</td>
                  <td className="py-2 text-xs text-slate-500">{o.carrier}</td>
                  <td className="py-2 text-xs text-slate-500">{new Date(o.orderDate).toLocaleDateString()}</td>
                  <td className="py-2 text-xs text-slate-500">{new Date(o.expectedDate).toLocaleDateString()}</td>
                  <td className="py-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${statusBadge(o.status)}`}>
                      {statusIcon(o.status)} {o.status.replace("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

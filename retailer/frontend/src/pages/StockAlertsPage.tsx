import { Link } from "react-router-dom";
import { AlertTriangle, XCircle, AlertCircle, Info, Clock, Loader2 } from "lucide-react";
import { useSupplyAlerts } from "../hooks/useSupplyData";

export default function StockAlertsPage() {
  const { data: alerts = [], isLoading: loading } = useSupplyAlerts();

  const critical = alerts.filter((a) => a.type === "critical");
  const warning = alerts.filter((a) => a.type === "warning");
  const info = alerts.filter((a) => a.type === "info");

  function formatTime(ts: string) {
    const d = new Date(ts);
    const now = new Date();
    const diff = Math.round((now.getTime() - d.getTime()) / 60000);
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.round(diff / 60)}h ago`;
    return `${Math.round(diff / 1440)}d ago`;
  }

  if (loading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-sm text-slate-500">Loading alerts...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <h1 className="text-xl font-bold text-slate-900">Stock Alerts</h1>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /> {critical.length} Critical</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> {warning.length} Warning</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400" /> {info.length} Info</span>
        </div>
      </div>

      <div className="space-y-3">
        {critical.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-red-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <XCircle className="w-3.5 h-3.5" /> Critical ({critical.length})
            </h3>
            <div className="space-y-2">
              {critical.map((a) => (
                <Link key={a.id} to={`/replenishment/brand/${encodeURIComponent(a.brand)}`} className="block p-4 bg-red-50 border border-red-200 rounded-xl hover:border-red-300 transition-all">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-red-900">{a.brand}</span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-red-200 text-red-800 rounded font-medium">{a.category}</span>
                      </div>
                      <div className="text-sm font-medium text-red-800 mt-1">{a.title}</div>
                      <div className="text-xs text-red-700 mt-0.5">{a.description}</div>
                      <div className="mt-2 text-[10px] font-semibold text-red-600 bg-red-100 inline-block px-2 py-0.5 rounded">Action: {a.action}</div>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-red-500 shrink-0">
                      <Clock className="w-3 h-3" />{formatTime(a.timestamp)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {warning.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-2 mt-4 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" /> Warning ({warning.length})
            </h3>
            <div className="space-y-2">
              {warning.map((a) => (
                <Link key={a.id} to={`/replenishment/brand/${encodeURIComponent(a.brand)}`} className="block p-4 bg-amber-50 border border-amber-200 rounded-xl hover:border-amber-300 transition-all">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-amber-900">{a.brand}</span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-200 text-amber-800 rounded font-medium">{a.category}</span>
                      </div>
                      <div className="text-sm font-medium text-amber-800 mt-1">{a.title}</div>
                      <div className="text-xs text-amber-700 mt-0.5">{a.description}</div>
                      <div className="mt-2 text-[10px] font-semibold text-amber-600 bg-amber-100 inline-block px-2 py-0.5 rounded">Action: {a.action}</div>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-amber-500 shrink-0">
                      <Clock className="w-3 h-3" />{formatTime(a.timestamp)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {info.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2 mt-4 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" /> Info ({info.length})
            </h3>
            <div className="space-y-2">
              {info.map((a) => (
                <Link key={a.id} to={`/replenishment/brand/${encodeURIComponent(a.brand)}`} className="block p-4 bg-blue-50 border border-blue-200 rounded-xl hover:border-blue-300 transition-all">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-blue-900">{a.brand}</span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-blue-200 text-blue-800 rounded font-medium">{a.category}</span>
                      </div>
                      <div className="text-sm font-medium text-blue-800 mt-1">{a.title}</div>
                      <div className="text-xs text-blue-700 mt-0.5">{a.description}</div>
                      <div className="mt-2 text-[10px] font-semibold text-blue-600 bg-blue-100 inline-block px-2 py-0.5 rounded">Action: {a.action}</div>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-blue-400 shrink-0">
                      <Clock className="w-3 h-3" />{formatTime(a.timestamp)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
